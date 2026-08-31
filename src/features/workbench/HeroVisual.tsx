import { Sparkles } from "lucide-react";

type Props = { label?: string; version?: string };

export function HeroVisual({ label = "CONTROLLED UI DSL", version = "SPEC / 01" }: Props) {
  return (
    <div className="hero-visual" aria-hidden="true">
      <div className="hero-orb">
        <div className="orb-halo" />
        <div className="orb-ring ring-one">
          <i />
        </div>
        <div className="orb-ring ring-two">
          <i />
        </div>
        <div className="orb-core">
          <Sparkles size={28} />
        </div>
      </div>
      <div className="orb-meta">
        <span className="signal-dot" />
        <span className="orb-label">{label}</span>
        <span className="orb-version">{version}</span>
      </div>
    </div>
  );
}
