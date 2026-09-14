import { SignInForm } from '../components/SignIn';

/** Full-page sign-in for direct links and auth redirects; the header opens the same form as a modal. */
export default function Login() {
  return (
    <div className="mb-16 md:m-auto md:w-[420px]">
      <SignInForm />
    </div>
  );
}
