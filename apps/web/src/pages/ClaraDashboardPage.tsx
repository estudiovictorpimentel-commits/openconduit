import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  FileText,
  MessageSquare,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDistanceToNow } from "date-fns";
import { PageTransition, motion } from "@/components/Motion";

interface ClaraOverview {
  stats: {
    activeConversations: number;
    handoffs: number;
    emotionalAttention: number;
    confusedConversations: number;
    pendingProposalPdfs: number;
  };
  pipeline: { name: string; value: number; color: string }[];
  conversations: {
    id: string;
    status: string;
    updatedAt: string;
    contact: {
      id: string;
      name: string;
      phone: string;
      notes: string | null;
      pipelineStage: { name: string; color: string } | null;
      tags: { id: string; name: string; color: string }[];
    };
    messages: { id: string; body: string | null; direction: string; createdAt: string }[];
  }[];
  followUps: {
    id: string;
    note: string;
    dueAt: string;
    contact: { id: string; name: string; phone: string };
  }[];
}

const fallback: ClaraOverview = {
  stats: {
    activeConversations: 0,
    handoffs: 0,
    emotionalAttention: 0,
    confusedConversations: 0,
    pendingProposalPdfs: 0,
  },
  pipeline: [
    { name: "New Lead", value: 0, color: "#6366f1" },
    { name: "Contacted", value: 0, color: "#3b82f6" },
    { name: "Proposal Sent", value: 0, color: "#f59e0b" },
    { name: "Converted", value: 0, color: "#10b981" },
  ],
  conversations: [],
  followUps: [],
};

const iconToneClass = {
  emerald: "text-emerald-300",
  amber: "text-amber-300",
  rose: "text-rose-300",
  sky: "text-sky-300",
} as const;

function toneFor(tags: { name: string }[]) {
  if (tags.some((tag) => tag.name === "Atenção emocional")) return "emotional";
  if (tags.some((tag) => tag.name === "Conversa confusa")) return "confused";
  if (tags.some((tag) => tag.name === "Handoff")) return "handoff";
  return "stable";
}

function toneLabel(tone: string) {
  if (tone === "emotional") return "Tom emocional";
  if (tone === "confused") return "Conversa confusa";
  if (tone === "handoff") return "Handoff";
  return "Estavel";
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function ClaraDashboardPage() {
  const [data, setData] = useState<ClaraOverview>(fallback);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const overview = await api.get<ClaraOverview>("/clara/overview");
        setData(overview);
      } catch (error) {
        console.error("Failed to load Clara overview", error);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const toneData = useMemo(() => {
    const counts = { Estavel: 0, Handoff: 0, Confusa: 0, Emocional: 0 };
    data.conversations.forEach((conversation) => {
      const tone = toneFor(conversation.contact.tags);
      if (tone === "handoff") counts.Handoff += 1;
      else if (tone === "confused") counts.Confusa += 1;
      else if (tone === "emotional") counts.Emocional += 1;
      else counts.Estavel += 1;
    });
    return [
      { name: "Estavel", value: counts.Estavel },
      { name: "Handoff", value: counts.Handoff },
      { name: "Confusa", value: counts.Confusa },
      { name: "Emocional", value: counts.Emocional },
    ];
  }, [data.conversations]);

  const headline = [
    { label: "Conversas ativas", value: data.stats.activeConversations, icon: MessageSquare, tone: "emerald" },
    { label: "Handoffs", value: data.stats.handoffs, icon: UserRound, tone: "amber" },
    { label: "Tom emocional", value: data.stats.emotionalAttention, icon: AlertTriangle, tone: "rose" },
    { label: "PDF pendente", value: data.stats.pendingProposalPdfs, icon: FileText, tone: "sky" },
  ];

  return (
    <PageTransition>
      <div className="min-h-full bg-slate-950 p-6 text-slate-100 lg:p-8">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
              <Bot className="h-3.5 w-3.5" />
              Clara pronta para WhatsApp + CRM
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Painel de atendimento e vendas
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Conversas, handoff, proposta em PDF, tom do cliente, pipeline e follow-up no mesmo lugar.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            API Clara: /api/v1/clara/conversations/sync
          </div>
        </header>

        {loading ? (
          <div className="flex h-96 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-400 border-t-transparent" />
          </div>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {headline.map((item) => (
                <motion.div
                  key={item.label}
                  className="rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-black/10"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-400">{item.label}</p>
                    <item.icon className={`h-5 w-5 ${iconToneClass[item.tone as keyof typeof iconToneClass]}`} />
                  </div>
                  <p className="mt-4 text-3xl font-semibold text-white">{compactNumber(item.value)}</p>
                </motion.div>
              ))}
            </section>

            <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_0.7fr]">
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-white">Inbox Clara</h2>
                    <p className="text-xs text-slate-500">Fila operacional para assumir conversas sem perder contexto.</p>
                  </div>
                  <Link to="/conversations" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300">
                    Ver todas <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                <div className="space-y-3">
                  {data.conversations.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
                      As conversas da Clara vao aparecer aqui quando a integracao enviar eventos.
                    </div>
                  ) : (
                    data.conversations.map((conversation) => {
                      const tone = toneFor(conversation.contact.tags);
                      const lastMessage = conversation.messages[0];
                      return (
                        <Link
                          key={conversation.id}
                          to={`/conversations/${conversation.id}`}
                          className="grid gap-4 rounded-lg border border-slate-800 bg-slate-950/70 p-4 transition hover:border-emerald-400/40 lg:grid-cols-[1fr_0.8fr_0.45fr]"
                        >
                          <div className="min-w-0">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-white">{conversation.contact.name}</span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                                <Phone className="h-3 w-3" /> {conversation.contact.phone}
                              </span>
                            </div>
                            <p className="truncate text-sm text-slate-400">{lastMessage?.body ?? "Sem mensagem recente"}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300">
                              {conversation.contact.pipelineStage?.name ?? "Sem etapa"}
                            </span>
                            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200">
                              {toneLabel(tone)}
                            </span>
                            {conversation.contact.tags.slice(0, 2).map((tag) => (
                              <span key={tag.id} className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
                                {tag.name}
                              </span>
                            ))}
                          </div>
                          <div className="text-right text-xs text-slate-500">
                            {formatDistanceToNow(new Date(conversation.updatedAt), { addSuffix: true })}
                          </div>
                        </Link>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
                <h2 className="text-base font-semibold text-white">Follow-ups</h2>
                <p className="mb-5 text-xs text-slate-500">Retornos comerciais e handoffs que precisam de acao humana.</p>
                <div className="space-y-3">
                  {data.followUps.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
                      Nenhum follow-up aberto.
                    </div>
                  ) : (
                    data.followUps.map((followUp) => (
                      <Link
                        key={followUp.id}
                        to={`/contacts/${followUp.contact.id}`}
                        className="block rounded-lg border border-slate-800 bg-slate-950/70 p-4 hover:border-sky-400/40"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-white">{followUp.contact.name}</p>
                          <CalendarClock className="h-4 w-4 text-sky-300" />
                        </div>
                        <p className="mt-2 max-h-10 overflow-hidden text-sm text-slate-400">{followUp.note}</p>
                        <p className="mt-3 text-xs text-slate-500">
                          {formatDistanceToNow(new Date(followUp.dueAt), { addSuffix: true })}
                        </p>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
                <h2 className="mb-5 text-base font-semibold text-white">Pipeline CRM</h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.pipeline}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#020617", border: "1px solid #1e293b", borderRadius: 8, color: "#e2e8f0" }} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {data.pipeline.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
                <h2 className="mb-5 text-base font-semibold text-white">Saude da conversa</h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={toneData}>
                      <defs>
                        <linearGradient id="toneFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "#020617", border: "1px solid #1e293b", borderRadius: 8, color: "#e2e8f0" }} />
                      <Area type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fill="url(#toneFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </PageTransition>
  );
}
