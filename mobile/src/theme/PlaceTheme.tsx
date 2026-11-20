import React, {createContext, useContext} from 'react';
import {colors} from './tokens';

// Place colors identify navigation, actions and their interaction states.
export const places = {
  identities: {
    soft: '#edf1e7',
    pale: colors.accentSoft,
    accent: colors.accent,
  },
  contacts: {
    soft: '#f7eeea',
    pale: '#f2e5df',
    accent: '#7e554c',
  },
  tools: {
    soft: '#eaf1f1',
    pale: '#ddebea',
    accent: '#326461',
  },
  mail: {
    soft: '#f4f0e7',
    pale: '#efeadb',
    accent: '#536647',
  },
  settings: {
    soft: '#f0ecf4',
    pale: '#eae3f1',
    accent: '#6b557e',
  },
  compose: {
    soft: '#edf2f6',
    pale: '#e2ebf1',
    accent: '#426779',
  },
};
export type Place = keyof typeof places;
const PlaceContext = createContext<Place>('identities');

export function PlaceThemeProvider({
  place,
  children,
}: {
  place: Place;
  children: React.ReactNode;
}) {
  return (
    <PlaceContext.Provider value={place}>{children}</PlaceContext.Provider>
  );
}

export function usePlaceTheme() {
  const place = useContext(PlaceContext);
  return {...places[place], place};
}
