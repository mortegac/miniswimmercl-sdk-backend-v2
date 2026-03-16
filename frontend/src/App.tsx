import { useAuthenticator } from "@aws-amplify/ui-react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// Pages (a implementar)
// import CustomersPage from "@/pages/CustomersPage";
// import WebformsPage from "@/pages/WebformsPage";
// import UsersPage from "@/pages/UsersPage";

export default function App() {
  const { user, signOut } = useAuthenticator();

  return (
    <BrowserRouter>
      <div>
        <header>
          <h1>MytAscensores Backoffice</h1>
          <span>Hola, {user.username}</span>
          <button onClick={signOut}>Cerrar sesión</button>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/customers" replace />} />
            {/* <Route path="/customers" element={<CustomersPage />} /> */}
            {/* <Route path="/webforms" element={<WebformsPage />} /> */}
            {/* <Route path="/users" element={<UsersPage />} /> */}
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
