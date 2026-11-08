import { createBrowserRouter, RouterProvider } from 'react-router';

import { AppProviders } from './providers';
import { routes } from './routes';

const router = createBrowserRouter(routes);

export function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
