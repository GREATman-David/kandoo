import { useState } from 'react';
import {
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { ForgotPasswordSheet } from '@/components/ForgotPasswordSheet';
import { colors, radius, spacing, text } from '@/theme/theme';

import { authErrorMessage, signIn, signUp } from '../../services/authService';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Errors read in alarm colour; a notice (e.g. "account created") reads muted.
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) {
      setError('Enter your email and password to continue.');
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (isCreatingAccount) {
        await signUp(email.trim(), password);
        setNotice('Account created. Check your email if confirmation is needed.');
      } else {
        await signIn(email.trim(), password);
        // On success the session changes and this screen unmounts — no message.
      }
    } catch (caught) {
      // Log the raw cause; show the person one plain, mapped line (never .message).
      console.error('Authentication error:', caught);
      setError(authErrorMessage(caught, isCreatingAccount ? 'signup' : 'signin'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Kandoo</Text>

      <Text style={styles.subtitle}>
        {isCreatingAccount
          ? 'Create your Kandoo account'
          : 'Welcome back'}
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.inkFaint}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.inkFaint}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
      />

      <Pressable
        style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
        onPress={handleSubmit}
        disabled={loading}
      >
        <Text style={styles.primaryButtonText}>
          {loading
            ? isCreatingAccount
              ? 'Creating account…'
              : 'Signing in…'
            : isCreatingAccount
              ? 'Create account'
              : 'Sign in'}
        </Text>
      </Pressable>

      {!isCreatingAccount ? (
        <Pressable
          style={styles.linkRow}
          onPress={() => setForgotOpen(true)}
          disabled={loading}
        >
          <Text style={styles.link}>Forgot your password?</Text>
        </Pressable>
      ) : null}

      <Pressable
        style={styles.secondaryButton}
        onPress={() => {
          setIsCreatingAccount((current) => !current);
          setError(null);
          setNotice(null);
        }}
        disabled={loading}
      >
        <Text style={styles.secondaryButtonText}>
          {isCreatingAccount
            ? 'Already have an account? Sign in'
            : 'Need an account? Create one'}
        </Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.message}>{notice}</Text> : null}

      <ForgotPasswordSheet
        visible={forgotOpen}
        onClose={() => setForgotOpen(false)}
        initialEmail={email.trim()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.space5,
    justifyContent: 'center',
    backgroundColor: colors.base,
  },

  title: {
    ...text.wordmark,
    textAlign: 'center',
    color: colors.ink,
  },

  subtitle: {
    ...text.bodyL,
    textAlign: 'center',
    marginTop: spacing.space3,
    marginBottom: spacing.space6,
    color: colors.inkMuted,
  },

  input: {
    ...text.bodyL,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.space4,
    color: colors.ink,
    backgroundColor: colors.surface,
    marginBottom: spacing.space2,
  },

  primaryButton: {
    backgroundColor: colors.accent,
    padding: spacing.space4,
    borderRadius: radius.md,
    marginTop: 2,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryButtonDisabled: {
    opacity: 0.6,
  },

  primaryButtonText: {
    ...text.bodyStrong,
    color: colors.base,
  },

  secondaryButton: {
    padding: spacing.space3,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  secondaryButtonText: {
    ...text.bodyStrong,
    color: colors.inkMuted,
  },

  message: {
    ...text.caption,
    marginTop: spacing.space4,
    textAlign: 'center',
    color: colors.inkMuted,
  },

  error: {
    ...text.caption,
    marginTop: spacing.space4,
    textAlign: 'center',
    color: colors.alarmText,
  },

  linkRow: {
    alignItems: 'center',
    paddingVertical: spacing.space3,
    minHeight: 40,
    justifyContent: 'center',
  },

  link: {
    ...text.caption,
    color: colors.inkMuted,
  },
});
