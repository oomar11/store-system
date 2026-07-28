/** In-memory session cache so hard navigations offline don't flash spinners. */

import type { Profile } from "@/types";
import type { ShiftRow } from "@/lib/shifts";

let memoryProfile: Profile | null = null;
let memoryShift: ShiftRow | null | undefined = undefined;

export function getMemoryProfile(): Profile | null {
  return memoryProfile;
}

export function setMemoryProfile(profile: Profile | null) {
  memoryProfile = profile;
}

export function getMemoryShift(): ShiftRow | null | undefined {
  return memoryShift;
}

export function setMemoryShift(shift: ShiftRow | null) {
  memoryShift = shift;
}

export function clearSessionMemory() {
  memoryProfile = null;
  memoryShift = undefined;
}
