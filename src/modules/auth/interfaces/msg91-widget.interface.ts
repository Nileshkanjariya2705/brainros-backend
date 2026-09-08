export interface Msg91VerifyTokenResponse {
  type?: string;
  message?: string;
  mobile?: string;
  email?: string;
  identifier?: string;
  user?: {
    mobile?: string;
    email?: string;
    phone?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface CheckUserExistResponse {
  user_found: boolean;
  identifier: string;
}
