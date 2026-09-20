import { useState } from 'react';
import {
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { colors, radius, spacing, text } from '@/theme/theme';

import { signIn, signUp } from '../../services/authService';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) {
      setMessage('Please enter your email and password.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      if (isCreatingAccount) {
        await signUp(email.trim(), password);
        setMessage(
          'Account created. Check your email if confirmation is required.'
        );
      } else {
        await signIn(email.trim(), password);
        setMessage('Signed in successfully.');
      }
    } catch (error) {
      console.error('Authentication error:', error);

      if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage('Authentication failed.');
      }
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
            ? 'Please wait...'
            : isCreatingAccount
              ? 'Create account'
              : 'Sign in'}
        </Text>
      </Pressable>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => {
          setIsCreatingAccount((current) => !current);
          setMessage('');
        }}
        disabled={loading}
      >
        <Text style={styles.secondaryButtonText}>
          {isCreatingAccount
            ? 'Already have an account? Sign in'
            : 'Need an account? Create one'}
        </Text>
      </Pressable>

      {message !== '' && (
        <Text style={styles.message}>
          {message}
        </Text>
      )}
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
});
