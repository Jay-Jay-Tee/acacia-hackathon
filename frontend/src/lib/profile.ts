import { useEffect, useState } from "react";

/** The aircraft the user is asking about. Sent as `model` / `serial` on every /ask. */
export interface Profile {
  model: string;
  serial: string;
}

export const EMPTY_PROFILE: Profile = { model: "", serial: "" };
export const PROFILE_MAX = 40; // docs/API.md limit for model and serial
const KEY = "adf.profile";

function load(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (p && typeof p.model === "string" && typeof p.serial === "string") {
      return { model: p.model.slice(0, PROFILE_MAX), serial: p.serial.slice(0, PROFILE_MAX) };
    }
  } catch {
    /* fall through to empty */
  }
  return EMPTY_PROFILE;
}

/** Profile that sticks across turns and page reloads. */
export function useProfile(): [Profile, (p: Profile) => void] {
  const [profile, setProfile] = useState<Profile>(load);
  useEffect(() => {
    if (profile.model || profile.serial) localStorage.setItem(KEY, JSON.stringify(profile));
    else localStorage.removeItem(KEY);
  }, [profile]);
  return [profile, setProfile];
}

export function cleanProfile(p: Profile): Profile {
  return { model: p.model.trim().slice(0, PROFILE_MAX), serial: p.serial.trim().slice(0, PROFILE_MAX) };
}

export function profileLabel(p: Profile): string {
  if (!p.model && !p.serial) return "No aircraft set";
  return [p.model || "any model", p.serial && `S/N ${p.serial}`].filter(Boolean).join(" · ");
}
