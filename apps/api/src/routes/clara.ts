import { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { config } from "../config.js";
import { normalizePhoneE164 } from "@openconduit/shared";

const CLARA_TAGS = [
  { name: "Clara", color: "#22c55e" },
  { name: "Handoff", color: "#f59e0b" },
  { name: "Atenção emocional", color: "#ef4444" },
  { name: "Conversa confusa", color: "#8b5cf6" },
  { name: "PDF pendente", color: "#0ea5e9" },
  { name: "Proposta pronta", color: "#10b981" },
] as const;

const inboundEventSchema = z.object({
  phone: z.string().min(7).max(20),
  name: z.string().min(1).max(255).optional(),
  waId: z.string().max(64).optional(),
  message: z.object({
    direction: z.enum(["INBOUND", "OUTBOUND"]).default("INBOUND"),
    type: z.enum(["TEXT", "IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "TEMPLATE"]).default("TEXT"),
    body: z.string().max(5000).nullable().optional(),
    mediaUrl: z.string().url().optional(),
    mediaType: z.string().max(120).optional(),
    providerMsgId: z.string().max(255).optional(),
    sentAt: z.string().datetime().optional(),
  }).optional(),
  service: z.string().max(120).optional(),
  niche: z.string().max(120).optional(),
  conversationHealth: z.object({
    status: z.enum(["healthy", "needs_recovery", "handoff_required"]).default("healthy"),
    signals: z.array(z.string().max(80)).default([]),
    recoveryCount: z.number().int().min(0).default(0),
  }).optional(),
  proposal: z.object({
    status: z.enum(["ready", "missing", "sent"]).optional(),
    pdfName: z.string().max(255).optional(),
  }).optional(),
  lead: z.object({
    stage: z.enum(["New Lead", "Contacted", "Proposal Sent", "Converted", "Closed"]).optional(),
    summary: z.string().max(1200).optional(),
    nextStep: z.string().max(500).optional(),
  }).optional(),
  handoff: z.object({
    required: z.boolean().default(false),
    reason: z.string().max(120).optional(),
    summary: z.string().max(1500).optional(),
    suggestedReply: z.string().max(500).optional(),
    ownerName: z.string().max(120).optional(),
  }).optional(),
});

const handoffSchema = inboundEventSchema.extend({
  handoff: inboundEventSchema.shape.handoff.unwrap().extend({
    required: z.literal(true),
    reason: z.string().min(1).max(120),
  }),
  dueAt: z.string().datetime().optional(),
});

type ClaraEvent = z.infer<typeof inboundEventSchema>;

function requireClaraToken(request: FastifyRequest) {
  if (!config.claraIntegrationToken && !config.isProduction) return true;

  const token = request.headers["x-clara-integration-token"];
  return typeof token === "string" && token === config.claraIntegrationToken;
}

function notesForEvent(event: ClaraEvent) {
  const parts = [
    event.lead?.summary && `Resumo Clara: ${event.lead.summary}`,
    event.service && `Servico: ${event.service}`,
    event.niche && `Nicho: ${event.niche}`,
    event.lead?.nextStep && `Proximo passo: ${event.lead.nextStep}`,
    event.conversationHealth && `Saude da conversa: ${event.conversationHealth.status} (${event.conversationHealth.signals.join(", ") || "sem sinais"})`,
    event.proposal?.status && `Proposta/PDF: ${event.proposal.status}${event.proposal.pdfName ? ` - ${event.proposal.pdfName}` : ""}`,
    event.handoff?.required && `Handoff: ${event.handoff.reason ?? "necessario"}${event.handoff.ownerName ? ` para ${event.handoff.ownerName}` : ""}`,
    event.handoff?.summary && `Contexto do handoff: ${event.handoff.summary}`,
    event.handoff?.suggestedReply && `Sugestao de entrada: ${event.handoff.suggestedReply}`,
  ].filter(Boolean);

  return parts.length ? parts.join("\n") : undefined;
}

async function upsertTag(name: string, color = "#64748b") {
  return prisma.tag.upsert({
    where: { name },
    create: { name, color },
    update: { color },
  });
}

async function ensureClaraTags(event: ClaraEvent) {
  const tags = await Promise.all(CLARA_TAGS.map((tag) => upsertTag(tag.name, tag.color)));
  const selected = new Set(["Clara"]);

  if (event.handoff?.required || event.conversationHealth?.status === "handoff_required") {
    selected.add("Handoff");
  }
  if (event.conversationHealth?.signals.some((signal) => signal.includes("frustration") || signal.includes("emotional"))) {
    selected.add("Atenção emocional");
  }
  if (event.conversationHealth?.signals.some((signal) => signal.includes("lost") || signal.includes("confus") || signal.includes("repeated"))) {
    selected.add("Conversa confusa");
  }
  if (event.proposal?.status === "missing") {
    selected.add("PDF pendente");
  }
  if (event.proposal?.status === "ready" || event.proposal?.status === "sent") {
    selected.add("Proposta pronta");
  }

  return tags.filter((tag) => selected.has(tag.name));
}

async function stageIdFor(name?: string) {
  if (!name) return undefined;
  const stage = await prisma.pipelineStage.findUnique({ where: { name } });
  return stage?.id;
}

async function upsertClaraConversation(event: ClaraEvent) {
  const phone = normalizePhoneE164(event.phone);
  if (!phone) {
    throw new Error("Invalid phone number format");
  }

  const tags = await ensureClaraTags(event);
  const note = notesForEvent(event);
  const pipelineStageId = await stageIdFor(
    event.lead?.stage ?? (event.proposal?.status === "sent" ? "Proposal Sent" : undefined),
  );

  const contact = await prisma.contact.upsert({
    where: { phone },
    create: {
      phone,
      name: event.name ?? phone,
      waId: event.waId,
      notes: note,
      optedIn: true,
      optedInAt: new Date(),
      pipelineStageId,
    },
    update: {
      name: event.name,
      waId: event.waId,
      notes: note ? { set: note } : undefined,
      optedIn: true,
      optedInAt: new Date(),
      pipelineStageId,
    },
  });

  await prisma.contactTag.createMany({
    data: tags.map((tag) => ({ contactId: contact.id, tagId: tag.id })),
    skipDuplicates: true,
  });

  let conversation = await prisma.conversation.findFirst({
    where: { contactId: contact.id, status: { not: "RESOLVED" } },
    orderBy: { updatedAt: "desc" },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        contactId: contact.id,
        status: event.handoff?.required ? "OPEN" : "PENDING",
      },
    });
  } else if (event.handoff?.required || event.conversationHealth?.status === "handoff_required") {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "OPEN" },
    });
  }

  if (event.message) {
    const existingMessage = event.message.providerMsgId
      ? await prisma.message.findFirst({ where: { providerMsgId: event.message.providerMsgId } })
      : null;

    if (!existingMessage) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: event.message.direction,
          type: event.message.type,
          body: event.message.body,
          mediaUrl: event.message.mediaUrl,
          mediaType: event.message.mediaType,
          providerMsgId: event.message.providerMsgId,
          sentAt: event.message.sentAt ? new Date(event.message.sentAt) : new Date(),
          status: "DELIVERED",
        },
      });
    }
  }

  if (event.handoff?.required) {
    const body = [
      "[Handoff Clara]",
      `Motivo: ${event.handoff.reason ?? "handoff_required"}`,
      event.handoff.summary && `Resumo: ${event.handoff.summary}`,
      event.handoff.suggestedReply && `Entrada sugerida: ${event.handoff.suggestedReply}`,
    ].filter(Boolean).join("\n");

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        type: "TEXT",
        body,
        status: "READ",
      },
    });
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  return prisma.conversation.findUnique({
    where: { id: conversation.id },
    include: {
      contact: { include: { tags: { include: { tag: true } }, pipelineStage: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function claraRoutes(app: FastifyInstance): Promise<void> {
  app.post("/conversations/sync", async (request, reply) => {
    if (!requireClaraToken(request)) {
      return reply.status(401).send({ error: "Unauthorized", message: "Invalid Clara integration token", statusCode: 401 });
    }

    const parsed = inboundEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    try {
      const conversation = await upsertClaraConversation(parsed.data);
      return reply.status(201).send({ conversation });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync Clara conversation";
      return reply.status(400).send({ error: "Bad Request", message, statusCode: 400 });
    }
  });

  app.post("/handoff", async (request, reply) => {
    if (!requireClaraToken(request)) {
      return reply.status(401).send({ error: "Unauthorized", message: "Invalid Clara integration token", statusCode: 401 });
    }

    const parsed = handoffSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    try {
      const conversation = await upsertClaraConversation(parsed.data);
      const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });

      if (admin && parsed.data.dueAt && conversation?.contactId) {
        await prisma.reminder.create({
          data: {
            contactId: conversation.contactId,
            userId: admin.id,
            dueAt: new Date(parsed.data.dueAt),
            note: `Retomar handoff da Clara: ${parsed.data.handoff.reason}`,
          },
        });
      }

      return reply.status(201).send({ conversation });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create Clara handoff";
      return reply.status(400).send({ error: "Bad Request", message, statusCode: 400 });
    }
  });

  app.get("/overview", { preHandler: authenticate }, async () => {
    const [openConversations, handoffTag, emotionalTag, confusedTag, pdfTag, pipelineStages, dueReminders] = await Promise.all([
      prisma.conversation.findMany({
        where: { status: { in: ["OPEN", "PENDING"] } },
        orderBy: { updatedAt: "desc" },
        take: 30,
        include: {
          contact: {
            include: {
              tags: { include: { tag: true } },
              pipelineStage: true,
            },
          },
          assignedTo: { select: { id: true, name: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 3 },
        },
      }),
      prisma.tag.findUnique({ where: { name: "Handoff" }, include: { _count: { select: { contacts: true } } } }),
      prisma.tag.findUnique({ where: { name: "Atenção emocional" }, include: { _count: { select: { contacts: true } } } }),
      prisma.tag.findUnique({ where: { name: "Conversa confusa" }, include: { _count: { select: { contacts: true } } } }),
      prisma.tag.findUnique({ where: { name: "PDF pendente" }, include: { _count: { select: { contacts: true } } } }),
      prisma.pipelineStage.findMany({
        orderBy: { order: "asc" },
        include: { _count: { select: { contacts: true } } },
      }),
      prisma.reminder.findMany({
        where: { completed: false },
        orderBy: { dueAt: "asc" },
        take: 10,
        include: { contact: { select: { id: true, name: true, phone: true } } },
      }),
    ]);

    return {
      stats: {
        activeConversations: openConversations.length,
        handoffs: handoffTag?._count.contacts ?? 0,
        emotionalAttention: emotionalTag?._count.contacts ?? 0,
        confusedConversations: confusedTag?._count.contacts ?? 0,
        pendingProposalPdfs: pdfTag?._count.contacts ?? 0,
      },
      pipeline: pipelineStages.map((stage: typeof pipelineStages[number]) => ({
        name: stage.name,
        value: stage._count.contacts,
        color: stage.color,
      })),
      conversations: openConversations.map((conversation: typeof openConversations[number]) => ({
        id: conversation.id,
        status: conversation.status,
        updatedAt: conversation.updatedAt,
        assignedTo: conversation.assignedTo,
        contact: {
          id: conversation.contact.id,
          name: conversation.contact.name,
          phone: conversation.contact.phone,
          notes: conversation.contact.notes,
          pipelineStage: conversation.contact.pipelineStage,
          tags: conversation.contact.tags.map((contactTag: typeof conversation.contact.tags[number]) => contactTag.tag),
        },
        messages: conversation.messages,
      })),
      followUps: dueReminders.map((reminder: typeof dueReminders[number]) => ({
        id: reminder.id,
        note: reminder.note,
        dueAt: reminder.dueAt,
        contact: reminder.contact,
      })),
    };
  });
}
