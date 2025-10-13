import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * A utility function to conditionally join class names together.
 * It uses 'clsx' to handle conditional classes and 'tailwind-merge'
 * to intelligently merge Tailwind CSS utility classes without conflicts.
 *
 * @param {...(string|Object|Array)} inputs - The class names to merge.
 * @returns {string} The merged class name string.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
