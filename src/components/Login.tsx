import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useGameStore } from '../store/useGameStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const user = useGameStore((state) => state.user);
  const setUser = useGameStore((state) => state.setUser);
  const checkAuth = useGameStore((state) => state.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setLoading(true);

    try {
      const endpoint = isRegistering ? '/register' : '/login';
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      setUser(data.user);
      setUsername('');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      setUser(null);
    } catch (err) {
    }
  };

  if (user) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h2>Account</h2>
        </div>
        <div className="connection-form">
          <p>Logged in as: <strong>{user.username}</strong></p>
          <button type="button" className="primary" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>{isRegistering ? 'Register' : 'Login'}</h2>
      </div>
      <form className="connection-form" onSubmit={handleSubmit}>
        {error && <div className="error-banner" style={{ marginBottom: '1rem' }}>{error}</div>}
        
        <label className="field">
          <span>Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            disabled={loading}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={4}
            disabled={loading}
          />
        </label>

        <div className="button-row">
          <button type="submit" className="primary" disabled={loading}>
            {loading ? 'Loading...' : (isRegistering ? 'Register' : 'Login')}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setIsRegistering(!isRegistering);
              setError(undefined);
            }}
            disabled={loading}
          >
            {isRegistering ? 'Switch to Login' : 'Switch to Register'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default Login;

