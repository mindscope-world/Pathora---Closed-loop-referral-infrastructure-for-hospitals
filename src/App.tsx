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
import { AcceptInvitePage } from './components/auth/AcceptInvitePage';

export default function App() {
  // An invitation link (…/?invite=TOKEN) opens the accept-invitation page. The token is moved into
  // memory and removed from the address bar immediately, so it does not linger in history or referrers.
  const [inviteToken, setInviteToken] = useState<string | null>(() => new URLSearchParams(window.location.search).get('invite'));
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('invite')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const [viewMode, setViewMode] = useState<'landing' | 'login' | 'signup' | 'invite' | 'dashboard'>(inviteToken ? 'invite' : 'landing');
  const { status, session, signOut } = useAuth();
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [selectedPathway, setSelectedPathway] = useState<string | undefined>(undefined);

  const handleOpenDiscovery = (pathway?: string) => {
    setSelectedPathway(pathway);
    setDiscoveryOpen(true);
  };

  const navigateTo = (mode: 'landing' | 'login' | 'signup' | 'invite' | 'dashboard') => {
    setViewMode(mode);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  const handleAuthSuccess = () => {
    setInviteToken(null);
    navigateTo('dashboard');
  };

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

  if (viewMode === 'invite' && inviteToken) {
    return (
      <AcceptInvitePage
        token={inviteToken}
        onSuccess={handleAuthSuccess}
        onBackToSite={() => {
          setInviteToken(null);
          navigateTo('landing');
        }}
      />
    );
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
