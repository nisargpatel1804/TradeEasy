import React from 'react';
import { Sun } from 'lucide-react';
import { Button } from '../assets/ui/button';

/**
 * ThemeToggle now simply communicates that light mode is enforced everywhere.
 */
export const ThemeToggle = () => (
  <Button
    variant="ghost"
    size="icon"
    aria-label="Light mode enabled"
    className="rounded-full cursor-default text-amber-500"
    disabled
  >
    <Sun className="h-5 w-5" />
  </Button>
);
