import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const TVA_PERCENT = 21;
export const TVA_RATE = TVA_PERCENT / 100;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
