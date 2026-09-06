import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/authApi';
import { useAuth } from '../auth/AuthContext';

export function useResource(path) {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ path, data: null, error: '', loading: true });
  const reload = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    Promise.resolve().then(() => {
      if (active) setState(s => ({ ...s, path, error: '', loading: true }));
      return apiRequest(path, { signal: controller.signal });
    }).then(data => {
      if (active) setState({ path, data, error: '', loading: false });
    }).catch(error => {
      if (!active || error.name === 'AbortError') return;
      if (error.status === 401 || (error.status === 403 && error.message === 'Account is inactive')) {
        clearSession(); navigate('/login', { replace: true });
      }
      setState({ path, data: null, error: error.message || 'Unable to load. Please try again.', loading: false });
    });
    return () => { active = false; controller.abort(); };
  }, [path, revision, clearSession, navigate]);
  return { ...(state.path === path ? state : { data: null, loading: true, error: '' }), reload };
}
