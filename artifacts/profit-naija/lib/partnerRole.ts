import type { User } from "firebase/auth";

export type PartnerRole = "agent" | "super_agent" | "referral" | "user";

export async function fetchPartnerRole(user: User): Promise<PartnerRole> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return "user";
  const token = await user.getIdToken();
  const response = await fetch(`https://${domain}/api/partners/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return "user";
  const body = await response.json().catch(() => ({}));
  return body.role === "agent" || body.role === "super_agent" || body.role === "referral" ? body.role : "user";
}

export function partnerDestination(role: PartnerRole): "/agent" | "/super-agent" | "/referrals" | "/(tabs)" {
  if (role === "super_agent") return "/super-agent";
  if (role === "agent") return "/agent";
  if (role === "referral") return "/referrals";
  return "/(tabs)";
}