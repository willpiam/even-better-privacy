import {useSecretPrompt} from '../hooks/useSecretPrompt';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Linking, StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Share from 'react-native-share';
import {useNavigation} from '@react-navigation/native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import StatusBanner from '../components/StatusBanner';
import {randomHex, validatePassword} from '../ebpCore';
import {createHdIdentity, createHdMnemonic} from '../services/hd';
import {publishIdentity} from '../services/publish';
import {getEnforcePasswordPolicy, getMailTestMode, getServerUrl} from '../services/settings';
import {getCurrentIdentity, listIdentities, setCurrentIdentity} from '../services/storage';
import {
  checkEbpUsername,
  createTestPaymentOrder,
  EbpMailApiError,
  fetchEbpSignupConfig,
  fetchPaymentOrderStatus,
  fetchTestPaymentAssets,
  rememberedPaymentOrder,
  rememberPaymentOrder,
  recoverTestPaymentOrder,
  resetEbpMailbox,
  signupEbpMailbox,
} from '../services/mail/ebpSignup';
import {
  checkoutHandoff,
  chooseIdentityName,
  formatUsdPrice,
  isAddressTakenError,
  isAlreadyHasMailboxError,
  mobileAddressChoice,
  pickQuizIndexes,
  quizMatches,
  TEST_MAIL_DOMAIN,
  testCheckoutUrl,
  validateMailUsername,
  type EbpSignupConfig,
  type OnboardingWizardStep,
  type PaymentAsset,
} from '../services/mail/ebpSignupLogic';
import {colors} from '../theme/tokens';
import FoxArt, {FoxMotion} from '../components/FoxArt';

type Step = OnboardingWizardStep;
type TaskState = 'pending' | 'running' | 'done' | 'error';
type TaskKey = 'keys' | 'publish' | 'mailbox';

const TASK_LABELS: Record<TaskKey, string> = {
  keys: 'Creating your post-quantum keys',
  publish: 'Publishing your public keys',
  mailbox: 'Creating your mailbox',
};

function randomInt(max: number): number {
  return parseInt(randomHex(4), 16) % max;
}

export default function OnboardingWizardScreen(): JSX.Element {
  // Registered in both the Identities and Mail stacks.
  const navigation = useNavigation<any>();
  const {secretPrompt} = useSecretPrompt();
  const [step, setStep] = useState<Step>('welcome');
  const [server, setServer] = useState('');
  const [config, setConfig] = useState<EbpSignupConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [username, setUsername] = useState('');
  const [usernameHint, setUsernameHint] = useState('');
  const [usernameOk, setUsernameOk] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [paid, setPaid] = useState(false);
  const [assets, setAssets] = useState<PaymentAsset[]>([]);
  const [assetIndex, setAssetIndex] = useState(0);
  const [orderId, setOrderId] = useState('');
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [checkoutMessage, setCheckoutMessage] = useState('');
  const [canOpenCheckout, setCanOpenCheckout] = useState(false);
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordHint, setPasswordHint] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [quiz, setQuiz] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [quizHint, setQuizHint] = useState('');
  const [tasks, setTasks] = useState<Record<TaskKey, TaskState>>({
    keys: 'pending',
    publish: 'pending',
    mailbox: 'pending',
  });
  const [createError, setCreateError] = useState('');
  const [identityName, setIdentityName] = useState('');
  const [currentIdentity, setCurrentIdentityName] = useState<string | null>(null);
  const [useExisting, setUseExisting] = useState(false);
  const [restored, setRestored] = useState(false);
  const [createStatus, setCreateStatus] = useState<number | undefined>();
  const [published, setPublished] = useState(false);
  const [result, setResult] = useState<{
    email: string;
    fingerprint: string;
    imap: string;
    smtp: string;
    login: string;
    mailPassword: string;
  } | null>(null);
  const [showConnection, setShowConnection] = useState(false);
  const checkSeq = useRef(0);

  useEffect(() => {
    void getCurrentIdentity().then(name => setCurrentIdentityName(name));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = await getServerUrl();
        const testing = await getMailTestMode();
        const cfg = await fetchEbpSignupConfig(url, testing);
        if (cancelled) return;
        setServer(url);
        setTestMode(testing);
        setConfig(cfg);
        if (testing && cfg.enabled && cfg.domain !== TEST_MAIL_DOMAIN) {
          setConfigError('This key server did not offer test.pqpost.com addresses.');
        } else if (!cfg.enabled) {
          setConfigError(
            "This key server doesn't offer EBP email addresses yet. You can still create keys and add an existing mailbox manually.",
          );
        }
      } catch (error) {
        if (!cancelled) {
          setConfigError(
            `Couldn't reach the key server (${error instanceof Error ? error.message : String(error)}).`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const domain = config?.enabled ? config.domain : '';

  const onUsernameChange = useCallback(
    (value: string) => {
      setUsername(value);
      setUsernameOk(false);
      setPaid(false);
      setAssets([]);
      const local = validateMailUsername(value);
      if (!value.trim()) {
        setUsernameHint('');
        return;
      }
      if (!local.ok) {
        setUsernameHint(local.reason);
        return;
      }
      setUsernameHint('Checking…');
      const seq = ++checkSeq.current;
      setTimeout(async () => {
        if (seq !== checkSeq.current) return;
        try {
          const res = await checkEbpUsername(server, local.username, testMode);
          if (seq !== checkSeq.current) return;
          const paymentAssets = res.purchasable && testMode
            ? await fetchTestPaymentAssets(server)
            : [];
          if (seq !== checkSeq.current) return;
          const choice = mobileAddressChoice({
            testMode,
            domain,
            availability: res,
            assets: paymentAssets,
          });
          if (choice.kind === 'available') {
            setUsernameOk(true);
            setUsernameHint(`${choice.username}@${domain} is available`);
          } else if (choice.kind === 'purchase') {
            setPaid(true);
            setAssets(choice.assets);
            setAssetIndex(0);
            setUsernameOk(true);
            setUsernameHint(`One-time price: ${formatUsdPrice(choice.usdCents)}`);
          } else {
            setUsernameHint(choice.reason);
          }
        } catch (error) {
          if (seq === checkSeq.current) {
            setUsernameHint(error instanceof Error ? error.message : String(error));
          }
        }
      }, 350);
    },
    [server, domain, testMode],
  );

  const normalizedUsername = username.trim().toLowerCase();

  const onPasswordNext = async () => {
    if (!password) {
      setPasswordHint('Enter a password.');
      return;
    }
    if (password !== confirmPassword) {
      setPasswordHint("Passwords don't match.");
      return;
    }
    const enforce = await getEnforcePasswordPolicy();
    const check = validatePassword(password, {enforcePolicy: enforce});
    if (!check.ok) {
      setPasswordHint([check.reason, ...check.suggestions].join(' '));
      return;
    }
    setPasswordHint('');
    if (!mnemonic) {
      setMnemonic(createHdMnemonic(256));
    }
    setStep('phrase');
  };

  const onPhraseNext = () => {
    const total = mnemonic.trim().split(/\s+/).length;
    setQuiz(pickQuizIndexes(3, total, randomInt));
    setAnswers({});
    setQuizHint('');
    setStep('confirm');
  };

  const setTask = (key: TaskKey, value: TaskState) =>
    setTasks(prev => ({...prev, [key]: value}));

  const runCreate = async () => {
    if (!config?.enabled) return;
    if (testMode && config.domain !== TEST_MAIL_DOMAIN) return;
    setStep('create');
    setCreateError('');
    setCreateStatus(undefined);
    setRestored(false);
    let current: TaskKey = 'keys';
    let keysPublished = published;
    try {
      let name = identityName;
      if (!name) {
        setTask('keys', 'running');
        const existing = (await listIdentities()).map(i => i.name);
        name = chooseIdentityName(normalizedUsername, existing, () =>
          Date.now().toString(36),
        );
        await createHdIdentity({
          name,
          mnemonic,
          password,
          profile: 'dilithium',
        });
        await setCurrentIdentity(name);
        setIdentityName(name);
        setTask('keys', 'done');
      }
      current = 'publish';
      if (!keysPublished) {
        setTask('publish', 'running');
        await publishIdentity({identityName: name, password, server});
        keysPublished = true;
        setPublished(true);
        setTask('publish', 'done');
      }
      if (paid) {
        const asset = assets[assetIndex] ?? assets[0];
        if (!asset) throw new Error('Choose a test-network payment.');
        let id = orderId || await rememberedPaymentOrder(server, name, normalizedUsername);
        if (!id) {
          id = await recoverTestPaymentOrder({
            identityName: name,
            password,
            username: normalizedUsername,
            domain,
            server,
          }) ?? '';
        }
        if (!id) {
          const created = await createTestPaymentOrder({
            identityName: name,
            password,
            username: normalizedUsername,
            domain,
            server,
            asset,
          });
          id = created.orderId;
        }
        setOrderId(id);
        await rememberPaymentOrder(server, name, normalizedUsername, id);
        const status = await fetchPaymentOrderStatus(server, id);
        if (status === 'expired') {
          await rememberPaymentOrder(server, name, normalizedUsername, null);
          setOrderId('');
          setCheckoutUrl('');
          setAwaitingPayment(false);
          setCreateError('The quote expired. If you sent a payment, contact support. Otherwise, request a new quote.');
          return;
        }
        if (status !== 'confirmed' && status !== 'fulfilled') {
          const url = testCheckoutUrl(server, id);
          if (!url) throw new Error('Checkout is not available for this key server.');
          const handoff = checkoutHandoff(url);
          setCheckoutUrl(handoff.url);
          setCanOpenCheckout(handoff.canOpenOnDevice && status !== 'manual_review');
          setCheckoutMessage(status === 'manual_review'
            ? 'This order needs support. Contact support before paying again.'
            : handoff.message);
          setAwaitingPayment(true);
          setCreateError('');
          return;
        }
        setAwaitingPayment(false);
        setCheckoutUrl('');
      }
      current = 'mailbox';
      setTask('mailbox', 'running');
      const res = await signupEbpMailbox({
        identityName: name,
        password,
        username: normalizedUsername,
        server,
        config,
        testMode,
      });
      setTask('mailbox', 'done');
      setResult({
        email: res.email,
        fingerprint: res.fingerprint,
        imap: `${res.imap.host}:${res.imap.port}`,
        smtp: `${res.smtp.host}:${res.smtp.port}`,
        login: res.login,
        mailPassword: res.mailPassword,
      });
      setPassword('');
      setConfirmPassword('');
      setMnemonic('');
      setStep('done');
    } catch (error) {
      if (!(current === 'publish' && keysPublished)) setTask(current, 'error');
      setCreateStatus(error instanceof EbpMailApiError ? error.status : undefined);
      setCreateError(error instanceof Error ? error.message : String(error));
    }
  };

  const runRestore = async () => {
    if (!config?.enabled || !identityName) return;
    setCreateError('');
    setCreateStatus(undefined);
    setTask('mailbox', 'running');
    try {
      const res = await resetEbpMailbox({
        identityName,
        password,
        server,
        config,
      });
      setTask('mailbox', 'done');
      setResult({
        email: res.email,
        fingerprint: res.fingerprint,
        imap: `${res.imap.host}:${res.imap.port}`,
        smtp: `${res.smtp.host}:${res.smtp.port}`,
        login: res.login,
        mailPassword: res.mailPassword,
      });
      setRestored(true);
      setPassword('');
      setConfirmPassword('');
      setMnemonic('');
      setStep('done');
    } catch (error) {
      setTask('mailbox', 'error');
      setCreateStatus(error instanceof EbpMailApiError ? error.status : undefined);
      setCreateError(error instanceof Error ? error.message : String(error));
    }
  };

  const startUseCurrent = () => {
    if (!currentIdentity) return;
    setUseExisting(true);
    setIdentityName(currentIdentity);
    setPublished(false);
    setPassword('');
    setPasswordHint('');
    setStep('address');
  };

  const onUnlockNext = () => {
    if (!password) {
      setPasswordHint('Enter the password for this identity.');
      return;
    }
    setPasswordHint('');
    void runCreate();
  };

  const onCreate = () => {
    if (!quizMatches(mnemonic, answers, quiz)) {
      setQuizHint("Those words don't match your phrase. Check and try again.");
      return;
    }
    void runCreate();
  };

  const onAddressNext = () => {
    if (!usernameOk) return;
    if (useExisting) {
      setStep('unlock');
      return;
    }
    if (identityName) {
      void runCreate();
      return;
    }
    setStep('password');
  };

  const openInbox = () => {
    navigation.getParent()?.navigate('MailTab', {screen: 'MailInbox'});
  };

  const words = mnemonic.trim() ? mnemonic.trim().split(/\s+/) : [];
  const testDomainReady = !testMode || (config?.enabled === true && config.domain === TEST_MAIL_DOMAIN);
  const addressTaken = isAddressTakenError(createError);
  const mailboxExists = isAlreadyHasMailboxError(createError, createStatus);
  const taskKeys: TaskKey[] = useExisting
    ? ['publish', 'mailbox']
    : ['keys', 'publish', 'mailbox'];

  return (
    <Screen scroll>
      {secretPrompt}
      {step === 'welcome' ? (
        <Card padded>
          <View style={styles.welcomeArt}>
            <FoxArt place="compose" size={180} />
          </View>
          <Text style={styles.title}>Get a quantum-secure email address</Text>
          <Text style={styles.body}>
            In about a minute you'll have a new email address and a set of
            post-quantum keys that sign and encrypt your mail end to end.
          </Text>
          <StatusBanner message={configError} kind="error" />
          <AppButton
            title="Get started"
            testID="onboarding-start"
            disabled={!config?.enabled || !testDomainReady}
            onPress={() => {
              setUseExisting(false);
              setStep('address');
            }}
          />
          {currentIdentity ? (
            <AppButton
              title="Use this identity"
              testID="onboarding-use-current"
              variant="secondary"
              disabled={!config?.enabled || !testDomainReady}
              onPress={startUseCurrent}
            />
          ) : null}
          <AppButton
            title="Set up manually"
            testID="onboarding-skip"
            variant="secondary"
            onPress={() => navigation.goBack()}
          />
        </Card>
      ) : null}

      {step === 'address' ? (
        <Card padded>
          <Text style={styles.title}>Choose your address</Text>
          {useExisting ? (
            <Text style={styles.hint}>
              Using {identityName}. Next you'll enter that identity's password.
            </Text>
          ) : null}
          <Text style={styles.hint}>
            3–30 characters: letters, numbers, dots, hyphens.
          </Text>
          {testMode ? (
            <Text style={styles.hint}>
              Test mode is on. This creates a @{domain || TEST_MAIL_DOMAIN} address and can only be paid on a test network.
            </Text>
          ) : null}
          <TextField
            label={`Username (@${domain})`}
            testID="onboarding-username"
            value={username}
            onChangeText={onUsernameChange}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text
            testID="onboarding-username-hint"
            style={[styles.hint, usernameOk ? styles.ok : styles.err]}>
            {usernameHint}
          </Text>
          {paid && assets.length ? (
            <View testID="onboarding-payment-assets">
              <Text style={styles.hint}>Payment asset</Text>
              {assets.map((asset, index) => (
                <AppButton
                  key={`${asset.network}:${asset.symbol}`}
                  title={`${assetIndex === index ? '✓ ' : ''}${asset.symbol} · ${asset.network}`}
                  testID={`onboarding-asset-${asset.symbol}`}
                  variant={assetIndex === index ? 'primary' : 'secondary'}
                  onPress={() => setAssetIndex(index)}
                />
              ))}
            </View>
          ) : null}
          <AppButton
            title="Next"
            testID="onboarding-address-next"
            disabled={!usernameOk}
            onPress={onAddressNext}
          />
        </Card>
      ) : null}

      {step === 'unlock' ? (
        <Card padded>
          <Text style={styles.title}>Unlock this identity</Text>
          <Text style={styles.hint}>
            Enter the password for {identityName}. It stays on this device and
            is used to publish your keys and create the mailbox.
          </Text>
          <TextField
            label="Identity password"
            testID="onboarding-unlock-password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <Text style={[styles.hint, styles.err]}>{passwordHint}</Text>
          <AppButton
            title="Next"
            testID="onboarding-unlock-next"
            onPress={onUnlockNext}
          />
          <AppButton title="Back" variant="secondary" onPress={() => setStep('address')} />
        </Card>
      ) : null}

      {step === 'password' ? (
        <Card padded>
          <Text style={styles.title}>Set a password</Text>
          <Text style={styles.hint}>
            This password unlocks your keys and mail on this device. It never
            leaves your phone.
          </Text>
          <TextField
            label="Password"
            testID="onboarding-password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TextField
            label="Confirm password"
            testID="onboarding-password-confirm"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />
          <Text style={[styles.hint, styles.err]}>{passwordHint}</Text>
          <AppButton
            title="Next"
            testID="onboarding-password-next"
            onPress={() => void onPasswordNext()}
          />
          <AppButton title="Back" variant="secondary" onPress={() => setStep('address')} />
        </Card>
      ) : null}

      {step === 'phrase' ? (
        <Card padded>
          <Text style={styles.title}>Save your recovery phrase</Text>
          <Text style={styles.hint}>
            Write these 24 words down in order and keep them somewhere safe.
            They are the only way to recover your keys and mailbox on a new
            device.
          </Text>
          <View style={styles.wordGrid} testID="onboarding-words">
            {words.map((word, i) => (
              <Text key={`${i}-${word}`} style={styles.word} testID={`onboarding-word-${i + 1}`}>
                {i + 1}. {word}
              </Text>
            ))}
          </View>
          <AppButton
            title="I wrote it down"
            testID="onboarding-phrase-next"
            onPress={onPhraseNext}
          />
          <AppButton title="Back" variant="secondary" onPress={() => setStep('password')} />
        </Card>
      ) : null}

      {step === 'confirm' ? (
        <Card padded>
          <Text style={styles.title}>Confirm your recovery phrase</Text>
          {quiz.map(index => (
            <TextField
              key={index}
              label={`Word #${index + 1}`}
              testID={`onboarding-quiz-${index + 1}`}
              value={answers[index] ?? ''}
              onChangeText={value => setAnswers(prev => ({...prev, [index]: value}))}
              autoCapitalize="none"
              autoCorrect={false}
            />
          ))}
          <Text style={[styles.hint, styles.err]}>{quizHint}</Text>
          <AppButton
            title="Create my address"
            testID="onboarding-create"
            onPress={onCreate}
          />
          <AppButton title="Back" variant="secondary" onPress={() => setStep('phrase')} />
        </Card>
      ) : null}

      {step === 'create' ? (
        <Card padded>
          <Text style={styles.title}>Setting things up</Text>
          {taskKeys.some(key => tasks[key] === 'running') ? (
            <View style={styles.welcomeArt}>
              <FoxMotion motion="watch" size={112} />
            </View>
          ) : null}
          {taskKeys.map(key => (
            <Text
              key={key}
              testID={`onboarding-task-${key}`}
              style={[styles.task, styles[`task_${tasks[key]}`]]}>
              {tasks[key] === 'done' ? '✓' : tasks[key] === 'error' ? '✗' : '○'}{' '}
              {TASK_LABELS[key]}
            </Text>
          ))}
          <StatusBanner
            message={
              mailboxExists
                ? 'This identity already has an EBP mailbox. Restore access to set a new mailbox password on this device.'
                : createError
            }
            kind="error"
          />
          {awaitingPayment && checkoutUrl ? (
            <View testID="onboarding-checkout">
              <Text style={styles.hint}>{checkoutMessage}</Text>
              <Text style={styles.fingerprint} selectable testID="onboarding-checkout-url">
                {checkoutUrl}
              </Text>
              <AppButton
                title="Copy link"
                testID="onboarding-copy-checkout"
                variant="secondary"
                onPress={() => {
                  Clipboard.setString(checkoutUrl);
                  setCheckoutMessage('Link copied. Open it on a computer, or paste it into your wallet browser.');
                }}
              />
              <AppButton
                title="Share link"
                testID="onboarding-share-checkout"
                variant="secondary"
                onPress={() => {
                  void Share.open({message: checkoutUrl, failOnCancel: false});
                }}
              />
              {canOpenCheckout ? (
                <AppButton
                  title="Open checkout"
                  testID="onboarding-open-checkout"
                  variant="secondary"
                  onPress={() => {
                    void Linking.openURL(checkoutUrl);
                  }}
                />
              ) : null}
            </View>
          ) : null}
          {createError || awaitingPayment ? (
            <AppButton
              title={
                mailboxExists
                  ? 'Restore access'
                  : awaitingPayment
                    ? 'Check payment'
                    : createError.startsWith('The quote expired')
                      ? 'Get a new quote'
                      : addressTaken
                        ? 'Choose another address'
                        : 'Try again'
              }
              testID={mailboxExists ? 'onboarding-restore' : 'onboarding-retry'}
              onPress={() => {
                if (mailboxExists) {
                  void runRestore();
                  return;
                }
                if (addressTaken) {
                  setUsernameOk(false);
                  setUsernameHint('');
                  setStep('address');
                } else {
                  void runCreate();
                }
              }}
            />
          ) : null}
        </Card>
      ) : null}

      {step === 'done' && result ? (
        <Card padded>
          <Text style={styles.title}>
            {restored ? 'Mailbox access restored' : "You're all set"}
          </Text>
          <Text style={styles.hint}>Your new address</Text>
          <Text style={styles.result} testID="onboarding-result-email" selectable>
            {result.email}
          </Text>
          <Text style={styles.hint}>Your identity fingerprint</Text>
          <Text style={styles.fingerprint} selectable>
            {result.fingerprint}
          </Text>
          <AppButton
            title="Open inbox"
            testID="onboarding-open-inbox"
            onPress={openInbox}
          />
          <AppButton
            title={showConnection ? 'Hide settings for other mail apps' : 'Use in other mail apps'}
            variant="secondary"
            onPress={() => setShowConnection(v => !v)}
          />
          {showConnection ? (
            <View testID="onboarding-connection">
              <Text style={styles.conn} selectable>IMAP: {result.imap} (SSL/TLS)</Text>
              <Text style={styles.conn} selectable>SMTP: {result.smtp} (SSL/TLS)</Text>
              <Text style={styles.conn} selectable>Username: {result.login}</Text>
              <Text style={styles.conn} selectable>Password: {result.mailPassword}</Text>
            </View>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  welcomeArt: {alignItems: 'center'},
  title: {fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 8},
  body: {fontSize: 14, color: colors.text, lineHeight: 20, marginBottom: 12},
  hint: {fontSize: 13, color: colors.muted, marginBottom: 8, lineHeight: 18},
  ok: {color: colors.success},
  err: {color: colors.danger},
  wordGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12},
  word: {width: '30%', fontSize: 13, color: colors.text},
  task: {fontSize: 14, paddingVertical: 4, color: colors.muted},
  task_pending: {color: colors.muted},
  task_running: {color: colors.text},
  task_done: {color: colors.success},
  task_error: {color: colors.danger},
  result: {fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 10},
  fingerprint: {fontSize: 12, color: colors.text, marginBottom: 12},
  conn: {fontSize: 13, color: colors.text, paddingVertical: 2},
});
