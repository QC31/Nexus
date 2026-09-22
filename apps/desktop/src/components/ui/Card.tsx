import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-[#3B171D] bg-[#170A0D] p-5 ${className}`}
    >
      {children}
    </div>
  );
}
