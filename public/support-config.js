// Payment settings for the Support tab. Leave a link empty ("") and its button shows "Opening soon".
// An adult (18+) owns the Stripe account. Create these in Stripe → Payment Links:
window.SUPPORT = {
  donateUrl: "",   // Payment Link with "customer chooses price", e.g. "https://buy.stripe.com/xxxx"
  plusUrl: "",     // Payment Link for the $5/month Deep Ball+ subscription
  manageUrl: "",   // Stripe customer portal link, so members can cancel themselves
  contactEmail: "", // shown in the policy section; Stripe requires a way to contact you
};
