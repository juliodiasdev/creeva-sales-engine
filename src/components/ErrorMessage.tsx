export function ErrorMessage({
  message,
}: {
  message: string;
}) {
  if (!message) return null;

  return <p className="error">{message}</p>;
}
