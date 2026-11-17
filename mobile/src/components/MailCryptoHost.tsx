import React, {useEffect, useRef} from 'react';
import {StyleSheet, View} from 'react-native';
import {WebView} from 'react-native-webview';
import {cryptoSource, cryptoScript} from '../services/mail/mailCryptoDocument';
import type {
  MailCryptoInput,
  MailCryptoResult,
} from '../services/mail/mailCryptoTypes';

export type CryptoWork = {
  input: MailCryptoInput;
  resolve: (result: MailCryptoResult) => void;
  reject: (error: Error) => void;
};
/** A fresh local runtime for each job; unmounted immediately after crypto finishes. */
export default function MailCryptoHost({work}: {work: CryptoWork}) {
  const ref = useRef<WebView<object>>(null);
  const settled = useRef(false);
  const finish = (result?: MailCryptoResult) => {
    if (settled.current) return;
    settled.current = true;
    work.input.key.fill(0);
    if (result) work.resolve(result);
    else
      work.reject(new Error('Encryption could not finish. Please try again.'));
  };
  useEffect(() => {
    const timer = setTimeout(() => finish(), 120_000);
    return () => {
      clearTimeout(timer);
      finish();
    };
    // Each host receives exactly one immutable job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View
      style={styles.host}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <WebView<object>
        ref={ref}
        source={cryptoSource}
        originWhitelist={['https://localhost']}
        webviewDebuggingEnabled={false}
        javaScriptEnabled
        domStorageEnabled={false}
        cacheEnabled={false}
        incognito
        allowFileAccess={false}
        mixedContentMode="never"
        onShouldStartLoadWithRequest={request =>
          request.url === 'https://localhost/' || request.url === 'about:blank'
        }
        onError={() => finish()}
        onHttpError={() => finish()}
        onContentProcessDidTerminate={() => finish()}
        onRenderProcessGone={() => {
          finish();
        }}
        onMessage={event => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.ready) {
              ref.current?.injectJavaScript(cryptoScript(work.input));
              work.input.key.fill(0);
            } else finish(data.result);
          } catch {
            finish();
          }
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
});
