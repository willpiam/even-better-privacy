import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import StatusBanner from '../components/StatusBanner';
import {randomHex, validatePassword} from '../ebpCore';
import {createHdIdentity, createHdMnemonic} from '../services/hd';
import {publishIdentity} from '../services/publish';
import {getEnforcePasswordPolicy, getServerUrl} from '../services/settings';
import {getCurrentIdentity, listIdentities, setCurrentIdentity} from '../services/storage';
import {appendActivityLog} from '../services/activityLog';
import {
  checkEbpUsername,
  EbpMailApiError,
  fetchEbpSignupConfig,
  resetEbpMailbox,
  signupEbpMailbox,
} from '../services/mail/ebpSignup';
import {
  chooseIdentityName,
  isAddressTakenError,
  isAlreadyHasMailboxError,
  pickQuizIndexes,
  quizMatches,
  validateMailUsername,
  type EbpSignupConfig,
  type OnboardingWizardStep,
} from '../services/mail/ebpSignupLogic';
import {colors} from '../theme/tokens';

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
  const [step, setStep] = useState<Step>('welcome');
  const [server, setServer] = useState('');
  const [config, setConfig] = useState<EbpSignupConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [username, setUsername] = useState('');
  const [usernameHint, setUsernameHint] = useState('');
  const [usernameOk, setUsernameOk] = useState(false);
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
        const cfg = await fetchEbpSignupConfig(url);
        if (cancelled) return;
        setServer(url);
        setConfig(cfg);
        if (!cfg.enabled) {
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
          const res = await checkEbpUsername(server, local.username);
          if (seq !== checkSeq.current) return;
          if (res.available) {
            setUsernameOk(true);
            setUsernameHint(`${res.username}@${domain} is available`);
          } else {
            setUsernameHint(res.reason ?? 'That address is taken.');
          }
        } catch (error) {
          if (seq === checkSeq.current) {
            setUsernameHint(error instanceof Error ? error.message : String(error));
          }
        }
      }, 350);
    },
    [server, domain],
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
    setStep('create');
    setCreateError('');
    setCreateStatus(undefined);
    setRestored(false);
    let current: TaskKey = 'keys';
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
      if (!published) {
        setTask('publish', 'running');
        await publishIdentity({identityName: name, password, server});
        setPublished(true);
        setTask('publish', 'done');
      }
      current = 'mailbox';
      setTask('mailbox', 'running');
      const res = await signupEbpMailbox({
        identityName: name,
        password,
        username: normalizedUsername,
        server,
        config,
      });
      setTask('mailbox', 'done');
      await appendActivityLog(`EBP mailbox created: ${res.email}`, 'success');
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
      setTask(current, 'error');
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
      await appendActivityLog(`EBP mailbox access restored: ${res.email}`, 'success');
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
  const addressTaken = isAddressTakenError(createError);
  const mailboxExists = isAlreadyHasMailboxError(createError, createStatus);
  const taskKeys: TaskKey[] = useExisting
    ? ['publish', 'mailbox']
    : ['keys', 'publish', 'mailbox'];

  return (
    <Screen scroll>
      {step === 'welcome' ? (
        <Card padded>
          <Text style={styles.title}>Get a quantum-secure email address</Text>
          <Text style={styles.body}>
            In about a minute you'll have a new email address and a set of
            post-quantum keys that sign and encrypt your mail end to end.
          </Text>
          <StatusBanner message={configError} kind="error" />
          <AppButton
            title="Get started"
            testID="onboarding-start"
            disabled={!config?.enabled}
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
              disabled={!config?.enabled}
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
          {createError ? (
            <AppButton
              title={
                mailboxExists
                  ? 'Restore access'
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
