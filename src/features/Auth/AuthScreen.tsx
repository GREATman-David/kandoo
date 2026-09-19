import { useState } from 'react';
import {
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

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
        placeholderTextColor="#777B87"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#777B87"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
      />

      <Pressable
        style={styles.primaryButton}
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
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#0B0D12',
  },

  title: {
    fontSize: 42,
    fontWeight: '800',
    textAlign: 'center',
    color: '#F5F3EE',
    letterSpacing: 1,
  },

  subtitle: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 30,
    color: '#A8A8B3',
  },

  input: {
    borderWidth: 1,
    borderColor: '#292D38',
    borderRadius: 16,
    padding: 16,
    fontSize: 16,
    color: '#F5F3EE',
    backgroundColor: '#151821',
    marginBottom: 10,
  },

  primaryButton: {
    backgroundColor: '#FFB86B',
    padding: 16,
    borderRadius: 16,
    marginTop: 2,
    alignItems: 'center',
  },

  primaryButtonText: {
    color: '#0B0D12',
    fontSize: 16,
    fontWeight: '700',
  },

  secondaryButton: {
    padding: 14,
    alignItems: 'center',
  },

  secondaryButtonText: {
    color: '#F5F3EE',
    fontSize: 15,
    fontWeight: '600',
  },

  message: {
    marginTop: 16,
    textAlign: 'center',
    color: '#A8A8B3',
    fontSize: 14,
  },
});