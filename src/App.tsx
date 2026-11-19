/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { WorkflowSplitSection } from './components/WorkflowSplitSection';
import { EcosystemMapSection } from './components/EcosystemMapSection';
import { PilotBlueprintSection } from './components/PilotBlueprintSection';
import { GovernanceAndScopeSection } from './components/GovernanceAndScopeSection';
import { DiscoverySection } from './components/DiscoverySection';
import { Footer } from './components/Footer';
import { DiscoveryModal } from './components/DiscoveryModal';
import { DashboardShell } from './components/dashboard/DashboardShell';
import { LoginPage } from './components/auth/LoginPage';
import { useAuth } from './auth/AuthProvider';
import { SignupPage } from './components/auth/SignupPage';

export default function App() {
  const [viewMode, setViewMode] = useState<'landing' | 'login' | 'signup' | 'dashboard'>('landing');
  const { status, session, signOut } = useAuth();
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [selectedPathway, setSelectedPathway] = useState<string | undefined>(undefined);

  const handleOpenDiscovery = (pathway?: string) => {
    setSelectedPathway(pathway);
    setDiscoveryOpen(true);
  };

  const navigateTo = (mode: 'landing' | 'login' | 'signup' | 'dashboard') => {
    setViewMode(mode);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  const handleAuthSuccess = () => navigateTo('dashboard');

  const handleSignOut = () => {
    void signOut();
    navigateTo('landing');
  };

  // A restored session (refresh cookie) goes straight to the dashboard instead of the marketing page.
  useEffect(() => {
    if (status === 'authenticated') {
      setViewMode((mode) => (mode === 'landing' ? 'dashboard' : mode));
    } else if (status === 'anonymous') {
      // Session ended (signed out, or a refresh failed mid-use): never leave the dashboard open.
      setViewMode((mode) => (mode === 'dashboard' ? 'login' : mode));
    }
  }, [status]);

  if (status === 'loading') {
    return <div className="min-h-screen bg-[#F8FAFC]" aria-busy="true" />;
  }

  if (viewMode === 'login') {
    return (
      <LoginPage
        onSuccess={handleAuthSuccess}
        onGoToSignup={() => navigateTo('signup')}
        onBackToSite={() => navigateTo('landing')}
      />
    );
  }

  if (viewMode === 'signup') {
    return (
      <SignupPage
        onSuccess={handleAuthSuccess}
        onGoToLogin={() => navigateTo('login')}
        onBackToSite={() => navigateTo('landing')}
      />
    );
  }

  if (viewMode === 'dashboard') {
    return (
      <DashboardShell
        currentUser={session}
        onExitDashboard={handleSignOut}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#061B3A]">
      <Navbar
        onOpenDiscovery={handleOpenDiscovery}
        onOpenLogin={() => navigateTo('login')}
      />

      <main className="flex-1">
        <HeroSection
          onOpenDiscovery={handleOpenDiscovery}
          onOpenSignup={() => navigateTo('signup')}
        />
        <WorkflowSplitSection />
        <EcosystemMapSection onOpenDiscovery={handleOpenDiscovery} />
        <PilotBlueprintSection onOpenDiscovery={handleOpenDiscovery} />
        <GovernanceAndScopeSection />
        <DiscoverySection />
      </main>

      <Footer
        onOpenLogin={() => navigateTo('login')}
        onOpenSignup={() => navigateTo('signup')}
      />

      <DiscoveryModal
        isOpen={discoveryOpen}
        initialPathway={selectedPathway}
        onClose={() => setDiscoveryOpen(false)}
      />
    </div>
  );
}
