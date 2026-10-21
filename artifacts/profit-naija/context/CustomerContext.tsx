/**
 * CustomerContext — Firestore-backed customer list with offline queuing.
 */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { collection, onSnapshot, orderBy, query, serverTimestamp, doc, updateDoc, runTransaction, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { normalizeNigerianPhone, normalizePartyName } from '@/lib/utils/party';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  normalizedPhone?: string;
  normalizedName?: string;
  homeAddress: string;
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  photoUri: string;
  createdAt: number;
}

interface CustomerContextValue {
  customers: Customer[];
  loading: boolean;
  addCustomer: (c: Omit<Customer, 'id' | 'createdAt'>) => Promise<void>;
  resolveOrUpsertCustomer: (c: Partial<Omit<Customer, 'id' | 'createdAt'>> & { customerId?: string }) => Promise<string>;
  updateCustomer: (id: string, c: Partial<Omit<Customer, 'id' | 'createdAt'>>) => Promise<void>;
}

// ── Context ───────────────────────────────────────────────────────────────────

const CustomerContext = createContext<CustomerContextValue | undefined>(undefined);

export function useCustomers() {
  const ctx = useContext(CustomerContext);
  if (!ctx) throw new Error('useCustomers must be used inside CustomerProvider');
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function CustomerProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.uid ?? null;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading]     = useState(true);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    setCustomers([]);
    setLoading(true);

    if (!userId) { setLoading(false); return; }

    try {
      const q = query(
        collection(db, `users/${userId}/customers`),
        orderBy('createdAt', 'desc'),
      );
      const unsub = onSnapshot(
        q,
        (snap) => {
          setCustomers(snap.docs.filter((d) => !d.data()._mergedInto).map((d) => {
            const data = d.data();
            return {
              id: d.id,
              fullName:        data.fullName        ?? '',
              phone:           data.phone           ?? '',
              email:           data.email           ?? '',
              normalizedPhone: data.normalizedPhone ?? normalizeNigerianPhone(data.phone),
              normalizedName:  data.normalizedName  ?? normalizePartyName(data.fullName),
              homeAddress:     data.homeAddress     ?? '',
              businessName:    data.businessName    ?? '',
              businessAddress: data.businessAddress ?? '',
              businessPhone:   data.businessPhone   ?? '',
              photoUri:        data.photoUri        ?? '',
              createdAt:       data.createdAt?.toMillis() ?? Date.now(),
            };
          }));
          setLoading(false);
        },
        (err) => {
          console.error('[CustomerContext]', err.code, err.message);
          setLoading(false);
        },
      );
      unsubRef.current = unsub;
    } catch (e) {
      console.error('[CustomerContext] subscribe threw:', e);
      setLoading(false);
    }

    return () => { if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; } };
  }, [userId]);

  const addCustomer = useCallback(async (c: Omit<Customer, 'id' | 'createdAt'>) => {
    if (!userId) throw new Error('Not signed in');
    const phone = normalizeNigerianPhone(c.phone);
    const name = normalizePartyName(c.fullName);
    const existing = phone ? customers.find(item =>
      (item.normalizedPhone || normalizeNigerianPhone(item.phone)) === phone,
    ) : undefined;
    const id = existing?.id || (phone ? `phone_${phone}` : `customer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
    await setDoc(doc(db, `users/${userId}/customers`, id), {
      ...c, userId, normalizedPhone: phone, normalizedName: name, createdAt: serverTimestamp(),
    }, { merge: true });
  }, [userId, customers]);

  /**
   * Resolve a customer using its selected id or canonical phone, then merge
   * only fields which are currently missing. The deterministic phone document
   * id makes retries safe when a device is offline and later drains writes.
   */
  const resolveOrUpsertCustomer = useCallback(async (
    input: Partial<Omit<Customer, 'id' | 'createdAt'>> & { customerId?: string },
  ): Promise<string> => {
    if (!userId) throw new Error('Not signed in');
    const normalizedPhone = normalizeNigerianPhone(input.phone);
    const normalizedName = normalizePartyName(input.fullName);
    // Prefer the live list before deriving a deterministic id. Older customer
    // records used random Firestore ids, so blindly deriving phone_<number>
    // here would create a second profile for the same person.
    const selected = input.customerId ? customers.find(c => c.id === input.customerId) : undefined;
    const byPhone = normalizedPhone
      ? customers.find(c => (c.normalizedPhone || normalizeNigerianPhone(c.phone)) === normalizedPhone)
      : undefined;
    const matched = selected || byPhone;
    const id = normalizedPhone ? `phone_${normalizedPhone}` : (matched?.id || input.customerId
      || `customer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const ref = doc(db, `users/${userId}/customers`, id);
    const values: Record<string, any> = {
      userId,
      ...(input.fullName ? { fullName: input.fullName.trim() } : {}),
      ...(input.phone ? { phone: input.phone.trim() } : {}),
      ...(input.email ? { email: input.email.trim() } : {}),
      ...(input.homeAddress ? { homeAddress: input.homeAddress.trim() } : {}),
      ...(input.businessName ? { businessName: input.businessName.trim() } : {}),
      ...(input.businessAddress ? { businessAddress: input.businessAddress.trim() } : {}),
      ...(input.businessPhone ? { businessPhone: input.businessPhone.trim() } : {}),
      ...(input.photoUri ? { photoUri: input.photoUri } : {}),
      ...(normalizedPhone ? { normalizedPhone } : {}),
      ...(normalizedName ? { normalizedName } : {}),
    };
    if (matched && matched.id !== id) {
      (['fullName', 'phone', 'email', 'homeAddress', 'businessName', 'businessAddress', 'businessPhone', 'photoUri'] as const)
        .forEach((key) => {
          if (!values[key] && matched[key]) values[key] = matched[key];
        });
    }
    await runTransaction(db, async (tx) => {
      const existing = await tx.get(ref);
      if (!existing.exists()) {
        tx.set(ref, { ...values, createdAt: serverTimestamp() });
        if (matched && matched.id !== id) {
          tx.update(doc(db, `users/${userId}/customers`, matched.id), { _mergedInto: id });
        }
        return;
      }
      const current = existing.data() || {};
      const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) =>
        key !== 'userId' && value !== undefined && value !== '' && (current[key] === undefined || current[key] === ''),
      ));
      if (Object.keys(patch).length) tx.update(ref, patch);
      if (matched && matched.id !== id) {
        tx.update(doc(db, `users/${userId}/customers`, matched.id), { _mergedInto: id });
      }
    });
    return id;
  }, [userId, customers]);

  const updateCustomer = useCallback(async (id: string, c: Partial<Omit<Customer, 'id' | 'createdAt'>>) => {
    if (!userId) throw new Error('Not signed in');
    const patch: Record<string, any> = { ...c };
    if (c.phone !== undefined) patch.normalizedPhone = normalizeNigerianPhone(c.phone);
    if (c.fullName !== undefined) patch.normalizedName = normalizePartyName(c.fullName);
    await updateDoc(doc(db, `users/${userId}/customers`, id), patch);
  }, [userId]);

  return (
    <CustomerContext.Provider value={{ customers, loading, addCustomer, resolveOrUpsertCustomer, updateCustomer }}>
      {children}
    </CustomerContext.Provider>
  );
}
