export type OtpPurpose =
  | 'LOGIN'
  | 'REGISTER'
  | 'CHANGE_MOBILE'
  | 'RESET_PASSWORD'
  | 'VERIFY_MOBILE'
  | 'VERIFY_EMAIL';

export interface TwoFactorProviderResult {
  sessionId?: string;
  providerManaged?: boolean;
  otpHash?: string;
}

export interface TwoFactorSessionData {
  sessionId?: string;
  providerManaged?: boolean;
  otpHash?: string;
}

export interface ITwoFactorProvider {
  readonly providerName: 'REAL' | 'DEVELOPMENT';

  /**
   * Sends an OTP or creates an OTP challenge for the destination.
   */
  sendOtp(
    destination: string,
    purpose: OtpPurpose,
  ): Promise<TwoFactorProviderResult>;

  /**
   * Verifies the user-entered OTP code.
   */
  verifyOtp(
    destination: string,
    otp: string,
    purpose: OtpPurpose,
    sessionData?: TwoFactorSessionData,
  ): Promise<boolean>;
}
