import './globals.css';
import type { Metadata } from 'next';
import { Sidebar } from '@/components/layout/sidebar';
import { CommandPalette } from '@/components/command-palette';
import { QueryProvider } from '@/components/providers/query-provider';
import { QueryBar } from '@/components/query-bar';

export const metadata: Metadata = {
  title: 'Hyperscale Leads',
  description: 'Autonomous lead generation system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-surface">
        <QueryProvider>
          <CommandPalette />
          <div className="flex h-screen">
            <Sidebar />
            <main className="flex-1 overflow-auto">
              <div className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur-sm px-6 py-3">
                <QueryBar />
              </div>
              <div className="p-6">
                {children}
              </div>
            </main>
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
