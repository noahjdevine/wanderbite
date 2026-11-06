/**
 * Synthetic Document Intelligence prebuilt-receipt JSON.
 * Not a photograph and not a customer receipt. Amounts match the E07-A1
 * example: total $100.00, tax $8.00, tip $10.00, food $82.00.
 */

export function azureEightyTwoReceipt(): Record<string, unknown> {
  return {
    status: 'succeeded',
    analyzeResult: {
      apiVersion: '2024-11-30',
      modelId: 'prebuilt-receipt',
      documents: [
        {
          docType: 'receipt.retailMeal',
          confidence: 0.95,
          fields: {
            MerchantName: {
              type: 'string',
              valueString: 'Fixture Grill',
              content: 'Fixture Grill',
              confidence: 0.99,
            },
            MerchantPhoneNumber: {
              type: 'phoneNumber',
              content: '987-654-3210',
              confidence: 0.9,
            },
            MerchantAddress: {
              type: 'address',
              content: '1 Fixture St',
              confidence: 0.9,
            },
            TransactionDate: {
              type: 'date',
              valueDate: '2026-11-06',
              content: 'November 6, 2026',
              confidence: 0.9,
            },
            TransactionTime: {
              type: 'time',
              valueTime: '12:00:00',
              content: '12:00 PM',
              confidence: 0.9,
            },
            Subtotal: {
              type: 'currency',
              valueCurrency: { amount: 82, currencyCode: 'USD' },
              content: '$82.00',
              confidence: 0.95,
            },
            TotalTax: {
              type: 'currency',
              valueCurrency: { amount: 8, currencyCode: 'USD' },
              content: '$8.00',
              confidence: 0.95,
            },
            Tip: {
              type: 'currency',
              valueCurrency: { amount: 10, currencyCode: 'USD' },
              content: '$10.00',
              confidence: 0.95,
            },
            Total: {
              type: 'currency',
              valueCurrency: { amount: 100, currencyCode: 'USD' },
              content: '$100.00',
              confidence: 0.99,
            },
            Items: {
              type: 'array',
              valueArray: [
                {
                  type: 'object',
                  confidence: 0.93,
                  valueObject: {
                    Description: {
                      type: 'string',
                      valueString: 'Food',
                      confidence: 0.93,
                    },
                    Quantity: { type: 'number', valueNumber: 1, confidence: 0.9 },
                    Price: {
                      type: 'currency',
                      valueCurrency: { amount: 82, currencyCode: 'USD' },
                      confidence: 0.9,
                    },
                    TotalPrice: {
                      type: 'currency',
                      valueCurrency: { amount: 82, currencyCode: 'USD' },
                      confidence: 0.93,
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  };
}
