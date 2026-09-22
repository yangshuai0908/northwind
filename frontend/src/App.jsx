import { Show, SignInButton, SignUpButton, UserButton, useAuth } from '@clerk/react'
import PageLoader from './components/PageLoader'
import Layout from './components/Layout';
import { Routes, Route, Navigate } from "react-router";
import HomePage from './pages/HomePage';
import CartPage from './pages/CartPage';

function App() {
  const { isLoaded } = useAuth();

  if (!isLoaded) return <PageLoader />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/cart" element={<CartPage />} />
        {/* <Route path="/product/:slug" element={<ProductDetailPage />} /> */}

      </Routes>
    </Layout>
  )
}

export default App
