import { IsNotEmpty, IsString } from 'class-validator';

export class CreateRegistrationPaymentOrderDto {
  @IsNotEmpty({ message: 'Registration ID is required' })
  @IsString()
  registrationId: string;
}

export class VerifyRegistrationPaymentDto {
  @IsNotEmpty({ message: 'Registration ID is required' })
  @IsString()
  registrationId: string;

  @IsNotEmpty({ message: 'Razorpay Payment ID is required' })
  @IsString()
  razorpay_payment_id: string;

  @IsNotEmpty({ message: 'Razorpay Order ID is required' })
  @IsString()
  razorpay_order_id: string;

  @IsNotEmpty({ message: 'Razorpay Signature is required' })
  @IsString()
  razorpay_signature: string;
}
