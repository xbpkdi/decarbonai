import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentMarkup } from "@/components/pages/AgentMarkup";
import { Runtime } from "@/components/Runtime";
import { YourAgents } from "@/components/YourAgents";
import { agentName } from "@/lib/config";
import { agentFeedback, agentRegistered, getSnapshotSafe } from "@/lib/server/chain";
import { getNet } from "@/lib/server/net";
import "@/styles/agent.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `${agentName(id)} · Agent` };
}

export default async function AgentPage({ params }: Props) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const net = await getNet();
  const [snapshot, feedback, registered] = await Promise.all([getSnapshotSafe(net), agentFeedback(net, BigInt(id)), agentRegistered(net, BigInt(id))]);
  return (
    <>
      <main data-page="agent" data-id={id} data-registered={registered ?? undefined}>
        <AgentMarkup net={net} feedback={feedback} yourAgents={<YourAgents current={Number(id)} />} />
      </main>
      <Runtime page="agent" snapshot={snapshot} />
    </>
  );
}
