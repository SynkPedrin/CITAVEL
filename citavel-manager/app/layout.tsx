import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: { default: 'CITÁVEL Manager', template: '%s · CITÁVEL' }, description: 'Presença em IA. Demanda mensurável.', icons: { icon: '/brand/citavel-icon.png' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
