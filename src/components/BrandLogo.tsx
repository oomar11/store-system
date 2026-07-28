import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  size?: number;
  className?: string;
  /** Always show the colored mark (e.g. login page). */
  variant?: "auto" | "color";
  priority?: boolean;
  alt?: string;
};

export function BrandLogo({
  size = 36,
  className,
  variant = "auto",
  priority,
  alt = "شعار ويندور",
}: BrandLogoProps) {
  if (variant === "color") {
    return (
      <Image
        src="/icons/icon-192.png"
        alt={alt}
        width={size}
        height={size}
        className={cn("brand-logo brand-logo--single object-contain", className)}
        priority={priority}
      />
    );
  }

  return (
    <span
      className={cn("brand-logo", className)}
      style={{ width: size, height: size }}
    >
      <Image
        src="/icons/icon-192.png"
        alt={alt}
        width={size}
        height={size}
        className="brand-logo__img brand-logo__img--light object-contain"
        priority={priority}
      />
      <Image
        src="/icons/icon-192-white.png"
        alt=""
        width={size}
        height={size}
        className="brand-logo__img brand-logo__img--dark object-contain"
        aria-hidden
        priority={priority}
      />
    </span>
  );
}
