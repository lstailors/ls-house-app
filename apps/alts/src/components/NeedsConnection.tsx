export function NeedsConnection({
  title = "Needs connection",
  detail = "This surface is live-only. It will be available when you're back online.",
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <div className="needs-connection" data-testid="needs-connection" role="status">
      <b>{title}</b>
      <p>{detail}</p>
    </div>
  );
}
