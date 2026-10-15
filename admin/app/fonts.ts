import localFont from 'next/font/local';

export const poppins = localFont({
  src: [
    { path: './fonts/Poppins-Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/Poppins-Medium.ttf', weight: '500', style: 'normal' },
    { path: './fonts/Poppins-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: './fonts/Poppins-Bold.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-poppins',
  display: 'swap',
  fallback: ['Arial', 'sans-serif'],
});

export const dmSans = localFont({
  src: [
    { path: './fonts/DMSans-Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/DMSans-Medium.ttf', weight: '500', style: 'normal' },
    { path: './fonts/DMSans-Bold.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-dm-sans',
  display: 'swap',
  fallback: ['Arial', 'sans-serif'],
});
