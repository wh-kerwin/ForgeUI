import { Sparkles } from "lucide-react";

export function HeroVisual() {
  return <div className="hero-orb"><div className="orb-ring ring-one" /><div className="orb-ring ring-two" /><div className="orb-core"><Sparkles size={28} /></div><span className="orb-label">CONTROLLED<br />UI DSL</span></div>;
}
