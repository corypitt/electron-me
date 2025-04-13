import React from 'react';
import Navbar from './Navbar';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full p-4">
        {children}
      </main>
    </div>
  );
} 