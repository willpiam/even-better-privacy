import React, {createContext, useContext} from 'react';

// The mockup's places are visual themes, independent of application features.
export const places = {
  identities: {
    page: '#f4f7f0',
    soft: '#edf1e7',
    pale: '#e5eddd',
    accent: '#466039',
    border: '#e1e6da',
    label: 'The identity grove',
  },
  contacts: {
    page: '#fcf5f2',
    soft: '#f7eeea',
    pale: '#f2e5df',
    accent: '#7e554c',
    border: '#ecdfd8',
    label: 'The contact garden',
  },
  tools: {
    page: '#f0f6f6',
    soft: '#eaf1f1',
    pale: '#ddebea',
    accent: '#326461',
    border: '#dce7e5',
    label: 'The crypto woodland',
  },
  mail: {
    page: '#faf7f0',
    soft: '#f4f0e7',
    pale: '#efeadb',
    accent: '#536647',
    border: '#e8e2d5',
    label: 'The mail meadow',
  },
  settings: {
    page: '#f7f4fa',
    soft: '#f0ecf4',
    pale: '#eae3f1',
    accent: '#6b557e',
    border: '#e6dfec',
    label: 'The quiet den',
  },
  compose: {
    page: '#f3f7fa',
    soft: '#edf2f6',
    pale: '#e2ebf1',
    accent: '#426779',
    border: '#dfe7ed',
    label: 'The letter path',
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
