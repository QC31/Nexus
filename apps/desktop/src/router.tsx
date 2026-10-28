import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

import { AppLayout } from "./components/layout/AppLayout";

const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  }))
);

const IpCalculatorPage = lazy(() =>
  import("./pages/IpCalculatorPage").then((module) => ({
    default: module.IpCalculatorPage,
  }))
);

const NetToolBoxPage = lazy(() =>
  import("./pages/NetToolBoxPage").then((module) => ({
    default: module.NetToolBoxPage,
  }))
);

const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  }))
);
const SshManagerPage = lazy(() => import("./pages/SshManagerPage"));
const KeyManagerPage = lazy(() => import("./pages/KeyManagerPage"));

function PageLoader() {
  return (
    <div style={{ padding: "24px", textAlign: "center" }}>
      Chargement…
    </div>
  );
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<PageLoader />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      {
        path: "/",
        element: withSuspense(<DashboardPage />),
      },
      {
        path: "/nettoolbox",
        element: withSuspense(<NetToolBoxPage />),
      },
      {
        path: "/ip-calculator",
        element: withSuspense(<IpCalculatorPage />),
      },
      {
        path: "/ssh",
        element: withSuspense(<SshManagerPage />),
      },
      {
        path: "/keys",
        element: withSuspense(<KeyManagerPage />),
      },
      {
        path: "/settings",
        element: withSuspense(<SettingsPage />),
      },
    ],
  },
]);