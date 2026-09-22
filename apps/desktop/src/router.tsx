import { createBrowserRouter } from "react-router-dom";

import { AppLayout } from "./components/layout/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { IpCalculatorPage } from "./pages/IpCalculatorPage";
import { NetToolBoxPage } from "./pages/NetToolBoxPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SshManagerPage } from "./pages/SshManagerPage";

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      {
        path: "/",
        element: <DashboardPage />,
      },
      {
        path: "/nettoolbox",
        element: <NetToolBoxPage />,
      },
      {
        path: "/ip-calculator",
        element: <IpCalculatorPage />,
      },
      {
        path: "/ssh",
        element: <SshManagerPage />,
      },
      {
        path: "/settings",
        element: <SettingsPage />,
      },
    ],
  },
]);