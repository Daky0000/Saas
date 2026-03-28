import React from 'react';

/** Official brand SVG logos for each social platform. */
function FacebookLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#1877F2" />
      <path
        d="M27.5 20C27.5 16.134 24.366 13 20.5 13C16.634 13 13.5 16.134 13.5 20C13.5 23.493 15.989 26.406 19.281 26.916V22.031H17.488V20H19.281V18.438C19.281 16.668 20.346 15.688 21.957 15.688C22.729 15.688 23.531 15.828 23.531 15.828V17.563H22.646C21.771 17.563 21.5 18.1 21.5 18.651V20H23.449L23.14 22.031H21.5V26.916C24.793 26.406 27.5 23.493 27.5 20Z"
        fill="white"
      />
    </svg>
  );
}

function InstagramLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ig-grad" cx="30%" cy="107%" r="150%">
          <stop offset="0%" stopColor="#fdf497" />
          <stop offset="5%" stopColor="#fdf497" />
          <stop offset="45%" stopColor="#fd5949" />
          <stop offset="60%" stopColor="#d6249f" />
          <stop offset="90%" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill="url(#ig-grad)" />
      <rect x="12" y="12" width="16" height="16" rx="5" stroke="white" strokeWidth="1.8" fill="none" />
      <circle cx="20" cy="20" r="4" stroke="white" strokeWidth="1.8" fill="none" />
      <circle cx="25.2" cy="14.8" r="1.1" fill="white" />
    </svg>
  );
}

function LinkedInLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#0A66C2" />
      <path
        d="M14.5 17.5H12V27H14.5V17.5ZM13.25 16.5C14.077 16.5 14.75 15.827 14.75 15C14.75 14.173 14.077 13.5 13.25 13.5C12.423 13.5 11.75 14.173 11.75 15C11.75 15.827 12.423 16.5 13.25 16.5ZM27 27H24.5V22.3C24.5 20.5 23.7 19.8 22.6 19.8C21.5 19.8 20.8 20.6 20.8 22.4V27H18.3V17.5H20.7V18.8C21.2 17.9 22.2 17.3 23.4 17.3C25.7 17.3 27 18.8 27 21.5V27Z"
        fill="white"
      />
    </svg>
  );
}

function XLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#000000" />
      <path
        d="M22.162 18.357L28.387 11H26.892L21.487 17.404L17.167 11H12L18.528 20.479L12 28.5H13.495L19.202 21.753L23.778 28.5H28.945L22.162 18.357ZM19.951 20.835L19.275 19.884L14.047 12.115H16.444L20.551 18.016L21.227 18.967L26.893 27.003H24.496L19.951 20.835Z"
        fill="white"
      />
    </svg>
  );
}

function PinterestLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#E60023" />
      <path
        d="M20 11C15.029 11 11 15.029 11 20C11 23.804 13.343 27.055 16.657 28.484C16.581 27.836 16.513 26.836 16.684 26.124C16.839 25.474 17.672 21.985 17.672 21.985C17.672 21.985 17.425 21.492 17.425 20.753C17.425 19.594 18.107 18.732 18.951 18.732C19.668 18.732 20.014 19.27 20.014 19.915C20.014 20.636 19.556 21.714 19.318 22.714C19.121 23.551 19.733 24.231 20.558 24.231C22.047 24.231 23.19 22.659 23.19 20.378C23.19 18.352 21.748 16.951 19.679 16.951C17.296 16.951 15.9 18.745 15.9 20.596C15.9 21.318 16.175 22.096 16.52 22.516C16.588 22.597 16.598 22.668 16.577 22.752C16.511 23.028 16.362 23.621 16.333 23.741C16.296 23.897 16.208 23.931 16.046 23.855C14.998 23.359 14.333 21.82 14.333 20.563C14.333 17.891 16.28 15.435 19.897 15.435C22.8 15.435 25.053 17.499 25.053 20.34C25.053 23.309 23.244 25.692 20.703 25.692C19.853 25.692 19.054 25.252 18.784 24.734L18.23 26.849C18.041 27.56 17.548 28.452 17.218 29C18.118 29.269 19.06 29.415 20.035 29.415C25.006 29.415 29.035 25.386 29.035 20.415C29.034 15.029 25.006 11 20 11Z"
        fill="white"
      />
    </svg>
  );
}

function ThreadsLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#000000" />
      <path
        d="M24.8 18.86a5.93 5.93 0 0 0-.28-.13c-.17-2.7-1.62-4.24-4.1-4.26h-.05c-1.49 0-2.72.63-3.48 1.79l1.3.89c.57-.86 1.46-1.04 2.18-1.04h.03c.84 0 1.47.25 1.87.74.3.36.5.85.59 1.46a10.4 10.4 0 0 0-2.38-.09c-2.39.14-3.93 1.53-3.83 3.47.05.98.54 1.82 1.39 2.37.71.46 1.63.69 2.58.64 1.26-.07 2.25-.55 2.93-1.42.52-.67.85-1.54.99-2.63.6.36 1.04.82 1.29 1.38.42.93.44 2.46-.86 3.75-1.13 1.12-2.49 1.6-4.54 1.62-2.28-.02-4-.75-5.12-2.16-1.04-1.31-1.58-3.21-1.6-5.65.02-2.44.56-4.34 1.6-5.65 1.12-1.41 2.84-2.14 5.12-2.16 2.29.02 3.92.76 4.96 2.17a7.7 7.7 0 0 1 1.12 2.47l1.55-.42a9.26 9.26 0 0 0-1.37-3c-1.35-1.8-3.37-2.73-6.26-2.75h-.02c-2.87.02-5.01 1-6.38 2.92-1.23 1.73-1.86 4.15-1.88 7.18.02 3.03.65 5.45 1.88 7.18 1.37 1.92 3.51 2.9 6.38 2.92h.02c2.56-.02 4.29-.73 5.75-2.18 1.91-1.9 1.86-4.27 1.22-5.73-.45-1.01-1.29-1.83-2.48-2.38zm-4.33 3.85c-1.05.06-2.14-.41-2.19-1.41-.04-.72.51-1.53 2.17-1.63.19-.01.38-.02.56-.02.62 0 1.21.06 1.74.18-.2 2.52-1.27 2.83-2.28 2.88z"
        fill="white"
      />
    </svg>
  );
}

function WordPressLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#21759B" />
      <path d="M11.04 20c0 3.73 2.17 6.97 5.32 8.56L11.7 16.1A8.98 8.98 0 0 0 11.04 20zm15.23-.46c0-1.16-.42-1.97-.78-2.6-.48-.78-.93-1.44-.93-2.22 0-.87.66-1.68 1.6-1.68l.12.01A8.96 8.96 0 0 0 20 11.04c-3.1 0-5.82 1.59-7.41 4l.57.02c.92 0 2.35-.11 2.35-.11.47-.03.53.67.06.72 0 0-.48.06-1.01.08l3.22 9.58 1.93-5.8-1.38-3.78c-.47-.02-.92-.08-.92-.08-.48-.03-.42-.75.06-.72 0 0 1.46.11 2.32.11.93 0 2.35-.11 2.35-.11.48-.03.54.67.06.72 0 0-.48.06-1.01.08l3.2 9.51.88-2.95c.38-1.22.67-2.1.67-2.85zm-5.38 1.13L18.3 28.3c.54.16 1.1.25 1.7.25.7 0 1.37-.12 2-.34l-.02-.04-3.19-9.5zm7.75-5.1a6.97 6.97 0 0 1 .06.93c0 .92-.17 1.95-.69 3.24l-2.76 7.98a9 9 0 0 0 3.39-12.15z" fill="white"/>
    </svg>
  );
}

function MailchimpLogo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#FFE01B" />
      <text x="20" y="26" textAnchor="middle" fill="#241C15" fontSize="13" fontWeight="900" fontFamily="sans-serif">MC</text>
    </svg>
  );
}

const LOGOS: Record<string, (size: number) => React.ReactElement> = {
  facebook: (s) => <FacebookLogo size={s} />,
  instagram: (s) => <InstagramLogo size={s} />,
  linkedin: (s) => <LinkedInLogo size={s} />,
  twitter: (s) => <XLogo size={s} />,
  x: (s) => <XLogo size={s} />,
  pinterest: (s) => <PinterestLogo size={s} />,
  threads: (s) => <ThreadsLogo size={s} />,
  wordpress: (s) => <WordPressLogo size={s} />,
  mailchimp: (s) => <MailchimpLogo size={s} />,
};

/**
 * Returns an official SVG logo for the given platform slug,
 * or a generic lettered circle if no logo is registered.
 */
export function PlatformLogo({ platform, size = 40 }: { platform: string; size?: number }) {
  const slug = platform.toLowerCase().trim();
  const logo = LOGOS[slug];
  if (logo) return logo(size);

  // Generic fallback
  const label = slug.slice(0, 2).toUpperCase();
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#64748b" />
      <text x="20" y="25" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="sans-serif">
        {label}
      </text>
    </svg>
  );
}
