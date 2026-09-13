import { CanvasApp } from "../../../components/canvas-app";

export default async function CanvasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CanvasApp key={id} projectId={id} />;
}
