export function Placeholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">
            EM BREVE
          </span>

          <h2>{title}</h2>
        </div>
      </div>

      <div className="empty">{description}</div>
    </section>
  );
}
