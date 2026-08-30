import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return null;
    if (data) {
      return user[data] ?? (data === 'id' ? user.userId ?? user.id : user[data]);
    }
    return user;
  },
);
