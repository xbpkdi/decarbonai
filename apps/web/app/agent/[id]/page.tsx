import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentMarkup } from "@/components/pages/AgentMarkup";
import { Runtime } from "@/components/Runtime";
import { YourAgents } from "@/components/YourAgents";
import { agentName } from "@/lib/config";
import { getSnapshotSafe } from "@/lib/server/chain";
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
  const snapshot = await getSnapshotSafe();
  return (
    <>
      <main data-page="agent" data-id={id}>
        <AgentMarkup yourAgents={<YourAgents current={Number(id)} />} />
      </main>
      <Runtime page="agent" snapshot={snapshot} />
    </>
  );
}
