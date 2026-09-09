import React from 'react';

export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="fixed left-3 top-3 z-[100] -translate-y-20 rounded border border-[#00f5d4]/70 bg-[#080e1a] px-4 py-3 text-sm font-semibold text-[#d7fff3] shadow-xl transition-transform focus:translate-y-0"
    >
      Skip to main content
    </a>
  );
}
