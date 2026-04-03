import React from 'react';
import {SafeAreaView, ScrollView, StyleSheet, Text} from 'react-native';

export default function ProjectInfoScreen(): JSX.Element {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView>
        <Text style={styles.header}>Project Info</Text>
        <Text style={styles.p}>
          EBP (Even Better Privacy) is a post-quantum cryptographic identity and
          messaging system using Dilithium/SPHINCS+ for signatures and Kyber for
          encryption.
        </Text>
        <Text style={styles.section}>How It Works</Text>
        <Text style={styles.p}>1. Generate identity (signing + encryption keys)</Text>
        <Text style={styles.p}>2. Share public identity and import contacts</Text>
        <Text style={styles.p}>3. Sign/verify messages and files</Text>
        <Text style={styles.p}>4. Encrypt/decrypt messages and files</Text>
        <Text style={styles.p}>5. Publish public identity to key server</Text>

        <Text style={styles.section}>Security Note</Text>
        <Text style={styles.p}>
          Keep private keys and revocation certificates secure. Anyone with your
          private keys (or emergency revocation cert) can act on your identity.
        </Text>

        <Text style={styles.section}>Links</Text>
        <Text style={styles.link}>https://github.com/willpiam/even-better-privacy</Text>
        <Text style={styles.link}>https://williamdoyle.ca/ebp</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fff', padding: 16},
  header: {fontSize: 22, fontWeight: '700', color: '#111', marginBottom: 10},
  section: {marginTop: 12, marginBottom: 6, fontSize: 16, fontWeight: '700', color: '#111'},
  p: {marginBottom: 6, color: '#222', lineHeight: 20},
  link: {marginBottom: 6, color: '#0b63d1'},
});
