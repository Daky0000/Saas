export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  price: number;
  billingPeriod: 'monthly' | 'yearly';
  features: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePricingPlanInput {
  name: string;
  description: string;
  price: number;
  billingPeriod: 'monthly' | 'yearly';
  features: string[];
}

export interface UpdatePricingPlanInput {
  name: string;
  description: string;
  price: number;
  billingPeriod: 'monthly' | 'yearly';
  features: string[];
  isActive: boolean;
}

export interface PricingPlanResponse {
  success: boolean;
  plan?: PricingPlan;
  plans?: PricingPlan[];
  error?: string;
}
