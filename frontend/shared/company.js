// Facts about the (fictional) company. The careers page and Fern's instructions
// both read from here, so the AI never contradicts the page. Edit freely.

export const company = {
  name: 'Fernway',
  assistantName: 'Fern',
  tagline: 'Calm, useful software for independent studios.',
  about:
    'Fernway builds booking and client-management software for independent studios: yoga teachers, tutors, salons and small clinics. We are a remote-first team of about 30 people.',
  values: [
    {
      title: 'Small team, real ownership',
      text: 'You ship work customers touch in your first month, and you own it from idea to release.',
    },
    {
      title: 'Calm over crunch',
      text: 'We plan instead of sprinting forever. Nobody is expected to answer messages after hours.',
    },
    {
      title: 'Write it down',
      text: 'We work async-first. Decisions live in shared docs, not in someone’s head.',
    },
    {
      title: 'Grow on purpose',
      text: 'Everyone gets a yearly learning budget, a mentor, and a growth chat every quarter.',
    },
  ],
  perks: [
    'Remote-first, flexible hours',
    'Yearly learning budget',
    'Home-office setup allowance',
    'Health cover',
    '20 days of paid leave, plus public holidays',
    'A team retreat once a year',
  ],
  hiringProcess: [
    'A 2-minute chat application on this page',
    'Our hiring team reviews new applications every week',
    'A 30-minute intro call with the hiring manager',
    'A short paid exercise or a portfolio walkthrough',
    'Meet the team, then an offer',
  ],
  // Shown after someone applies. Only promise what your team will really do.
  reviewPromise: 'Our hiring team reviews new applications every week and replies to everyone by email within 7 days.',
  contactEmail: 'careers@fernway.example',
  fictionalNotice:
    'Fernway is a fictional company created for a university project. Applications sent here are test data.',
};
