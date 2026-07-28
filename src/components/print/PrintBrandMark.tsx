type PrintBrandMarkProps = {
  className?: string;
  sizeClassName?: string;
  /** Custom store logo URL; falls back to default black print mark */
  logoUrl?: string | null;
};

/** Logo for print headers (white paper). */
export function PrintBrandMark({
  className = "mx-auto mb-1",
  sizeClassName = "h-10 w-10",
  logoUrl,
}: PrintBrandMarkProps) {
  const src = logoUrl?.trim() || "/icons/logo-print-black.png";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={`${className} ${sizeClassName} object-contain`}
    />
  );
}
