import {useCallback, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {listIdentities} from '../services/storage';
import {getServerUrl} from '../services/settings';
import {getIdentityDetails} from '../services/details';
import {isUnlocked} from '../services/unlockSession';
import {
  fetchIdentityPublication,
  mergeIdentityDetails,
  type IdentityDetail,
  type IdentityPublication,
} from '../services/identityPublication';
import type {StoredIdentityMeta} from '../types';
import {useIdentityUnlock} from './useIdentityUnlock';

export function useIdentityProfile(identityName: string) {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [identity, setIdentity] = useState<StoredIdentityMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverUrl, setServerUrl] = useState('');
  const [localDetails, setLocalDetails] = useState<IdentityDetail[]>([]);
  const [locallyRevokedPaths, setLocallyRevokedPaths] = useState<string[]>([]);
  const [locallyRevoked, setLocallyRevoked] = useState(false);
  const [sessionUnlocked, setSessionUnlocked] = useState(false);
  const [error, setError] = useState('');
  const [publication, setPublication] = useState<IdentityPublication>({
    state: 'checking',
  });
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const id = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = () => generation.current === id;
    setError('');
    setPublication({state: 'checking'});
    try {
      const [all, server] = await Promise.all([
        listIdentities(),
        getServerUrl(),
      ]);
      if (!current()) return;
      const meta = all.find(item => item.name === identityName) ?? null;
      setIdentity(meta);
      setServerUrl(server);
      setLoading(false);
      setLocalDetails([]);
      setLocallyRevokedPaths([]);
      setLocallyRevoked(false);
      setSessionUnlocked(Boolean(meta && isUnlocked(meta.name)));
      if (!meta) return;
      const local = async () => {
        if (!isUnlocked(meta.name)) return;
        try {
          const snapshot = await getIdentityDetails({identityName: meta.name});
          if (current()) {
            setLocalDetails(snapshot.details);
            setLocallyRevokedPaths(snapshot.revokedPaths);
            setLocallyRevoked(snapshot.revoked);
          }
        } catch (e) {
          if (current()) {
            setSessionUnlocked(false);
            setError(e instanceof Error ? e.message : String(e));
          }
        }
      };
      const remote = async (): Promise<IdentityPublication> => {
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
          return await fetchIdentityPublication(
            meta.fingerprint,
            server,
            controller.signal,
          );
        } catch {
          return {
            state: 'unavailable',
            message: 'Could not check this server. Try again when connected.',
          };
        } finally {
          clearTimeout(timeout);
        }
      };
      const [, result] = await Promise.all([local(), remote()]);
      if (current()) setPublication(result);
    } catch (e) {
      if (current()) {
        setLoading(false);
        setError(e instanceof Error ? e.message : String(e));
        setPublication({
          state: 'unavailable',
          message: 'Could not load identity status.',
        });
      }
    }
  }, [identityName]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') void refresh();
      });
      return () => {
        generation.current++;
        request.current?.abort();
        subscription.remove();
      };
    }, [refresh]),
  );

  const unlock = useCallback(async () => {
    const name = await ensureUnlocked(identityName);
    if (name) await refresh();
    return name;
  }, [ensureUnlocked, identityName, refresh]);

  return {
    identity,
    loading,
    serverUrl,
    publication,
    sessionUnlocked,
    error,
    details: locallyRevoked
      ? []
      : mergeIdentityDetails(localDetails, publication, locallyRevokedPaths),
    localDetails,
    locallyRevoked,
    refresh,
    unlock,
    ensureUnlocked,
    unlockPrompt,
  };
}
